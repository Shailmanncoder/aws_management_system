import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { READ_PERMISSION, WRITE_PERMISSION, recordInput, resourceSnapshot, changedFields, type RecordKind, type RecordInput } from "@/lib/operations";
import { inventoryViewQuery } from "@/lib/inventory-views";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { AppError, notFound, conflict } from "../errors";
import { insertAudit } from "../repositories/audit-repository";
import { listCloudConnections } from "./cloud-service";
import { getPriorities, getHelp } from "./simple-service";
import { makePlan } from "../aws/provisioning/service";
import { configurationSchema } from "@/lib/provisioning";

export const jsonValue = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function operationsAudit(a: OrgAccess, action: string, targetId: string) {
  await insertAudit({ organizationId: a.organizationId, actorUserId: a.userId, action, targetType: "operations", targetId, outcome: "SUCCESS", metadata: {} });
}
export async function ownedResource(a: OrgAccess, id: string) {
  assertCan(a, "inventory:read");
  const resource = await getDb().awsResource.findFirst({ where: { organizationId: a.organizationId, id, deletedAt: null }, include: { tags: true } });
  if (!resource) throw notFound("Resource");
  return resource;
}
export async function listRecords(a: OrgAccess, kind?: RecordKind) {
  if (kind) assertCan(a, READ_PERMISSION[kind]);
  const kinds = (Object.keys(READ_PERMISSION) as RecordKind[]).filter(k => a.can(READ_PERMISSION[k]) && (k !== "SAVING" || a.can("cost:read")) && (!kind || k === kind));
  return getDb().workspaceRecord.findMany({ where: { organizationId: a.organizationId, kind: { in: kinds }, OR: [{ shared: true }, { userId: a.userId }] }, orderBy: { updatedAt: "desc" }, take: 500 });
}
async function editable(a: OrgAccess, id: string) {
  const record = await getDb().workspaceRecord.findFirst({ where: { organizationId: a.organizationId, id, OR: [{ shared: true }, { userId: a.userId }] } });
  if (!record) throw notFound("Saved item");
  assertCan(a, WRITE_PERMISSION[record.kind as RecordKind]);
  const assignedIncident = record.kind === "INCIDENT" && (record.payload as { assigneeId?: string }).assigneeId === a.userId;
  if (record.userId !== a.userId && !assignedIncident && !a.can("org:update")) throw new AppError("FORBIDDEN", "Only the creator, incident assignee or a workspace administrator can edit this item.");
  return record;
}
export async function saveRecord(a: OrgAccess, raw: RecordInput, id?: string, version?: number) {
  const input = recordInput.parse(raw);
  assertCan(a, WRITE_PERMISSION[input.kind]);
  const existing = id ? await editable(a, id) : null;
  if (existing && existing.kind !== input.kind) throw conflict("The item type cannot change.");
  const db = getDb(), organizationId = a.organizationId;
  let payload: unknown = input.payload;
  let resourceId: string | null = null;
  if ("resourceId" in input.payload && input.payload.resourceId) {
    const resource = await ownedResource(a, input.payload.resourceId);
    resourceId = resource.id;
    if (input.kind === "BASELINE") payload = { resourceId, snapshot: resourceSnapshot(resource), capturedAt: new Date().toISOString() };
  }
  if (input.kind === "OWNER" && input.payload.projectId && !await db.businessProject.findFirst({ where: { organizationId, id: input.payload.projectId } })) throw notFound("Project");
  if (input.kind === "VIEW") {
    if (input.shared) assertCan(a, "operations:manage");
    payload = { ...input.payload, query: inventoryViewQuery(input.payload.query) };
  }
  if (input.kind === "INCIDENT") {
    for (const resourceId of input.payload.resourceIds) await ownedResource(a, resourceId);
    const member = await db.organizationMember.findFirst({ where: { organizationId, userId: input.payload.assigneeId } });
    if (!member) throw notFound("Assignee");
    const { hasPermission } = await import("@/lib/rbac");
    if (!hasPermission(member.role, "operations:manage")) throw new AppError("VALIDATION_FAILED", "Choose a teammate with operations access.");
    const previous = existing?.payload as { timeline?: unknown[] } | undefined;
    payload = { ...input.payload, timeline: [...(previous?.timeline ?? []).slice(-99), { at: new Date().toISOString(), by: a.userId, note: input.payload.note, status: input.payload.status }] };
  }
  if (input.kind === "TEMPLATE") {
    if (!await db.awsAccount.findFirst({ where: { organizationId, id: input.payload.accountId } })) throw notFound("Account");
  }
  if (input.kind === "NOTIFICATION") {
    const member = await db.organizationMember.findFirst({ where: { organizationId, userId: input.payload.memberId }, include: { user: true } });
    if (!member || !member.user.emailVerified) throw new AppError("VALIDATION_FAILED", "Choose a workspace member with a verified email address.");
    if (input.payload.ruleId && !await db.alertRule.findFirst({ where: { organizationId, id: input.payload.ruleId } })) throw notFound("Alert rule");
  }
  if (input.kind === "SAVING") {
    assertCan(a, "cost:read");
    if (existing) throw conflict("Savings baselines are immutable; create a new tracking entry.");
    const finding = await db.optimizationFinding.findFirst({ where: { organizationId, id: input.payload.findingId } });
    if (!finding) throw notFound("Recommendation");
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 7 * 86400000);
    const costs = await db.costRecord.findMany({ where: { organizationId, awsAccountRefId: finding.awsAccountRefId, awsAccount: { costScopeVersion: 1 }, granularity: "DAILY", dimension: "TOTAL", periodStart: { gte: start, lt: end } } });
    payload = { ...input.payload, accountId: finding.awsAccountRefId, acceptedAt: end.toISOString(), baseline: sumCosts(costs), estimatedMonthlySavings: finding.estimatedMonthlySavings?.toString() ?? null, estimatedCurrency: finding.savingsCurrency, basis: "Whole account; changes are not proof of savings caused by this recommendation." };
  }
  const data = { name: input.name, resourceId, payload: jsonValue(payload), shared: input.kind === "VIEW" ? input.shared : true };
  if (existing) {
    const updated = await db.workspaceRecord.updateMany({ where: { id: existing.id, organizationId, version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) throw conflict("This item changed. Refresh before editing.");
  } else {
    if (await db.workspaceRecord.count({ where: { organizationId, kind: input.kind } }) >= 500) throw conflict("This workspace has reached the 500-item limit for this feature.");
  }
  const result = existing ? await db.workspaceRecord.findFirstOrThrow({ where: { id: existing.id, organizationId } }) : await db.workspaceRecord.create({ data: { ...data, organizationId, userId: a.userId, kind: input.kind } });
  await operationsAudit(a, `operations.${input.kind.toLowerCase()}.saved`, result.id);
  return result;
}
export async function deleteRecord(a: OrgAccess, id: string) {
  await editable(a, id);
  await getDb().workspaceRecord.deleteMany({ where: { organizationId: a.organizationId, id } });
  await operationsAudit(a, "operations.item.deleted", id);
  return { ok: true };
}
export async function templatePlan(a: OrgAccess, id: string, name?: string) {
  assertCan(a, "provisioning:create");
  const template = await getDb().workspaceRecord.findFirst({ where: { organizationId: a.organizationId, id, kind: "TEMPLATE" } });
  if (!template) throw notFound("Template");
  return makePlan(a, { configuration: configurationSchema.parse({ ...(template.payload as object), ...(name ? { name } : {}) }), idempotencyKey: randomUUID() });
}
export function sumCosts(rows: { unit: string; amount: unknown; periodStart: Date; estimated?: boolean }[]) {
  const map = new Map<string, { currency: string; amount: number; days: Set<string>; estimated: boolean }>();
  for (const r of rows) {
    const v = map.get(r.unit) ?? { currency: r.unit, amount: 0, days: new Set<string>(), estimated: false };
    v.amount += Number(r.amount); v.days.add(r.periodStart.toISOString().slice(0, 10)); v.estimated ||= !!r.estimated; map.set(r.unit, v);
  }
  return [...map.values()].map(v => ({ ...v, days: v.days.size }));
}
export async function getOperations(a: OrgAccess) {
  assertCan(a, "org:read");
  const db = getDb(), organizationId = a.organizationId;
  const [records, resources, changes, priorities, help, clouds, costs, findings, members, plans, deliveries, org, rules, security, metrics, credentials] = await Promise.all([
    listRecords(a),
    a.can("inventory:read") ? db.awsResource.findMany({ where: { organizationId, deletedAt: null }, include: { tags: true, awsAccount: { select: { displayName: true, lastSyncedAt: true, syncStatus: true } } }, orderBy: { id: "asc" }, take: 2000 }) : [],
    a.can("inventory:read") ? db.resourceChange.findMany({ where: { organizationId }, orderBy: { observedAt: "desc" }, take: 200 }) : [],
    getPriorities(a), getHelp(a), listCloudConnections(a),
    a.can("cost:read") ? db.costRecord.findMany({ where: { organizationId, awsAccount: { costScopeVersion: 1 }, granularity: "DAILY", dimension: { in: ["TOTAL", "SERVICE"] }, periodStart: { gte: new Date(Date.now() - 35 * 86400000) } }, orderBy: { periodStart: "desc" }, take: 20000 }) : [],
    a.can("optimization:read") ? db.optimizationFinding.findMany({ where: { organizationId, status: "OPEN" }, take: 200, orderBy: { lastSeenAt: "desc" } }) : [],
    a.can("members:read") ? db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true } } } }) : [],
    a.can("actions:request") || a.can("org:update") ? db.operationPlan.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    a.can("alerts:manage") ? db.notificationDelivery.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 100 }) : [],
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { requiredTagKeys: true, actionModeEnabled: true } }),
    a.can("alerts:manage") ? db.alertRule.findMany({ where: { organizationId }, select: { id: true, name: true } }) : [],
    a.can("security:read") ? db.securityFinding.findMany({ where: { organizationId, status: "OPEN" }, select: { id: true, title: true, resourceRefId: true, severity: true }, take: 500 }) : [],
    a.can("metrics:read") ? db.metricSummary.findMany({ where: { organizationId }, take: 1000, orderBy: { collectedAt: "desc" } }) : [],
    a.can("security:read") ? db.awsAccount.findMany({ where: { organizationId }, select: { id: true, displayName: true, securityScannedAt: true, securityCoverage: true } }) : [],
  ]);
  const baselines = records.filter(r => r.kind === "BASELINE").map(r => {
    const p = r.payload as { resourceId: string; snapshot: unknown; capturedAt: string };
    const current = resources.find(v => v.id === p.resourceId);
    return { id: r.id, name: r.name, resourceId: p.resourceId, capturedAt: p.capturedAt, changes: current ? changedFields(p.snapshot, resourceSnapshot(current)) : [], observed: !!current, before: p.snapshot, after: current ? resourceSnapshot(current) : null };
  });
  const savings = records.filter(r => r.kind === "SAVING").map(r => {
    const p = r.payload as { accountId: string; acceptedAt: string; baseline: ReturnType<typeof sumCosts> };
    const start = new Date(p.acceptedAt), end = new Date(start.getTime() + 7 * 86400000);
    return { id: r.id, after: sumCosts(costs.filter(c => c.dimension === "TOTAL" && c.awsAccountRefId === p.accountId && c.periodStart >= start && c.periodStart < end)), complete: end.getTime() < Date.now() };
  });
  return jsonValue({ records, resources, changes, priorities, help, clouds, costs: costs.map(c => ({ ...c, amount: Number(c.amount) })), findings, members, plans, deliveries, org, rules, baselines, savings, security, metrics, credentials, truncated: resources.length === 2000 || costs.length === 20000 });
}
