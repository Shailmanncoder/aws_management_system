import "server-only";
import { z } from "zod";
import { HELP_KINDS, HELP_PERMISSION, helpHref, weekWindow, type HelpKind, type PriorityAction } from "@/lib/simple";
import { hasPermission } from "@/lib/rbac";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { AppError, notFound } from "../errors";
import { recordAudit, AUDIT } from "./audit-service";
import { type Scope } from "./dashboard-service";
import { ruleConfigSchemas } from "./alert-service";

export async function getPriorities(access: OrgAccess, scope: Scope = {}) {
  assertCan(access, "org:read");
  const db = getDb(), organizationId = access.organizationId;
  const findingWhere = { organizationId, status: "OPEN" as const, ...(scope.account ? { awsAccountRefId: scope.account } : {}), ...(scope.region ? { region: scope.region } : {}) };
  const [accounts, security, savings] = await Promise.all([
    access.can("aws_accounts:read") ? db.awsAccount.findMany({ where: { organizationId, ...(scope.account ? { id: scope.account } : {}) }, select: { id: true, displayName: true, lastSyncedAt: true, syncStatus: true } }) : [],
    access.can("security:read") ? db.securityFinding.findMany({ where: findingWhere, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 5 }) : [],
    access.can("optimization:read") ? db.optimizationFinding.findMany({ where: findingWhere, orderBy: [{ estimatedMonthlySavings: { sort: "desc", nulls: "last" } }, { confidence: "asc" }, { lastSeenAt: "desc" }], take: 3 }) : [],
  ]);
  const actions: PriorityAction[] = [
    ...accounts.filter(a => ["FAILED", "PARTIAL"].includes(a.syncStatus) || !a.lastSyncedAt || Date.now() - a.lastSyncedAt.getTime() > 26 * 3600_000).map(a => ({
      id: a.id, kind: "sync" as const, title: `Check the connection to ${a.displayName}`, reason: "Some information is missing or out of date. The dashboard may not show recent changes.", next: "Open the account and review its connection checks.", href: helpHref("sync", a.id), priority: "Review soon" as const, checkedAt: a.lastSyncedAt?.toISOString() ?? null,
    })),
    ...security.map(f => ({ id: f.id, kind: "security" as const, title: f.title, reason: f.rationale, next: "Review the evidence and the step-by-step fix before making a change.", href: helpHref("security", f.id), priority: ["CRITICAL", "HIGH"].includes(f.severity) ? "Urgent" as const : "Review soon" as const, checkedAt: f.lastSeenAt.toISOString() })),
    ...savings.map(f => ({ id: f.id, kind: "optimization" as const, title: f.title, reason: f.reason, next: f.recommendation, href: helpHref("optimization", f.id), priority: "Opportunity" as const, checkedAt: f.lastSeenAt.toISOString() })),
  ];
  const rank = { Urgent: 0, "Review soon": 1, Opportunity: 2 };
  actions.sort((a,b) => rank[a.priority] - rank[b.priority]);
  return { actions: actions.slice(0, 8), accounts, lastChecked: accounts.map(a => a.lastSyncedAt).filter((d): d is Date => d !== null).sort((a,b) => a.getTime() - b.getTime())[0] ?? null };
}

export const budgetInput = z.strictObject({ amount: z.number().positive().max(1e9), currency: z.string().regex(/^[A-Z]{3}$/), warningPercent: z.number().int().min(1).max(100).default(80) });
export async function saveBudget(access: OrgAccess, input: z.infer<typeof budgetInput>) {
  assertCan(access, "alerts:manage"); assertCan(access, "cost:read");
  const config = { monthToDateAmount: input.amount, currency: input.currency, scope: "WORKSPACE", warningPercent: input.warningPercent };
  const rule = await getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${access.organizationId}::uuid FOR UPDATE`;
    const existing = await tx.alertRule.findFirst({ where: { organizationId: access.organizationId, type: "COST_THRESHOLD", AND: [{ config: { path: ["scope"], equals: "WORKSPACE" } }, { config: { path: ["currency"], equals: input.currency } }] } });
    const data = { name: `Monthly budget (${input.currency})`, config, enabled: true };
    return existing ? tx.alertRule.update({ where: { id: existing.id }, data }) : tx.alertRule.create({ data: { ...data, organizationId: access.organizationId, type: "COST_THRESHOLD", channels: ["IN_APP"], createdById: access.userId } });
  });
  await recordAudit({ action: AUDIT.ALERT_RULE_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "alert_rule", targetId: rule.id, metadata: { op: "budget", currency: input.currency } });
  return { id: rule.id };
}
export async function getBudgets(access: OrgAccess) {
  assertCan(access, "cost:read");
  const rows = await getDb().alertRule.findMany({ where: { organizationId: access.organizationId, type: "COST_THRESHOLD" }, orderBy: { createdAt: "asc" } });
  return rows.flatMap(r => { const p = ruleConfigSchemas.COST_THRESHOLD.safeParse(r.config); return p.success && p.data.scope === "WORKSPACE" ? [{ id: r.id, enabled: r.enabled, amount: p.data.monthToDateAmount, currency: p.data.currency, warningPercent: p.data.warningPercent }] : []; });
}

export const projectInput = z.strictObject({ name: z.string().trim().min(2).max(80), owner: z.string().trim().min(2).max(100), description: z.string().trim().max(500).default(""), accountIds: z.array(z.uuid()).max(100).refine(a => new Set(a).size === a.length, "Choose each account once") });
export async function saveProject(access: OrgAccess, input: z.infer<typeof projectInput>, id?: string) {
  assertCan(access, "org:update");
  const organizationId = access.organizationId;
  const project = await getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
    if (id && !await tx.businessProject.findFirst({ where: { id, organizationId } })) throw notFound("Project");
    const count = await tx.awsAccount.count({ where: { organizationId, id: { in: input.accountIds } } });
    if (count !== input.accountIds.length) throw notFound("Account");
    const taken = await tx.businessProjectAccount.count({ where: { organizationId, accountId: { in: input.accountIds }, ...(id ? { projectId: { not: id } } : {}) } });
    if (taken) throw new AppError("CONFLICT", "An account already belongs to another project. Remove it from that project first.");
    const data = { name: input.name, owner: input.owner, description: input.description };
    const p = id ? await tx.businessProject.update({ where: { id }, data }) : await tx.businessProject.create({ data: { ...data, organizationId } });
    await tx.businessProjectAccount.deleteMany({ where: { organizationId, projectId: p.id } });
    if (input.accountIds.length) await tx.businessProjectAccount.createMany({ data: input.accountIds.map(accountId => ({ organizationId, projectId: p.id, accountId })) });
    return p;
  });
  await recordAudit({ action: AUDIT.PROJECT_CHANGED, organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "project", targetId: project.id, metadata: { op: id ? "update" : "create" } });
  return project;
}
export async function deleteProject(access: OrgAccess, id: string) {
  assertCan(access, "org:update");
  if (!(await getDb().businessProject.deleteMany({ where: { id, organizationId: access.organizationId } })).count) throw notFound("Project");
  await recordAudit({ action: AUDIT.PROJECT_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "project", targetId: id, metadata: { op: "delete" } });
}
export async function getProjects(access: OrgAccess) {
  assertCan(access, "org:read");
  const db = getDb(), organizationId = access.organizationId;
  const now = new Date(), month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [projects, accounts, costs, resources] = await Promise.all([
    db.businessProject.findMany({ where: { organizationId }, include: { accounts: true }, orderBy: { name: "asc" } }),
    db.awsAccount.findMany({ where: { organizationId }, select: { id: true, displayName: true, lastSyncedAt: true } }),
    access.can("cost:read") ? db.costRecord.groupBy({ by: ["awsAccountRefId", "unit"], where: { organizationId, awsAccount: { costScopeVersion: 1 }, granularity: "DAILY", dimension: "TOTAL", periodStart: { gte: month, lte: now } }, _sum: { amount: true } }) : [],
    access.can("inventory:read") ? db.awsResource.groupBy({ by: ["awsAccountRefId"], where: { organizationId, deletedAt: null }, _count: { _all: true } }) : [],
  ]);
  return { accounts, projects: projects.map(p => {
    const ids = new Set(p.accounts.map(a => a.accountId)), totals = new Map<string, number>();
    for (const c of costs) if (ids.has(c.awsAccountRefId)) totals.set(c.unit, (totals.get(c.unit) ?? 0) + Number(c._sum.amount ?? 0));
    return { id: p.id, name: p.name, owner: p.owner, description: p.description, accountIds: [...ids], totals: [...totals].map(([currency, amount]) => ({ currency, amount })), resourceCount: resources.filter(r => ids.has(r.awsAccountRefId)).reduce((s,r) => s + r._count._all, 0) };
  }) };
}

export const helpInput = z.strictObject({ kind: z.enum(HELP_KINDS), targetId: z.uuid(), assigneeId: z.uuid(), note: z.string().trim().max(1000).default("") });
export async function helpMembers(access: OrgAccess) {
  assertCan(access, "members:read");
  return getDb().organizationMember.findMany({ where: { organizationId: access.organizationId }, select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
}
export async function createHelp(access: OrgAccess, input: z.infer<typeof helpInput>) {
  assertCan(access, HELP_PERMISSION[input.kind]); assertCan(access, "members:read");
  const organizationId = access.organizationId, db = getDb();
  const request = await db.$transaction(async tx => {
    // Membership edits take this same workspace lock. Check recipient access inside it.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
    const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: input.assigneeId } } });
    if (!member || !hasPermission(member.role, HELP_PERMISSION[input.kind])) throw new AppError("VALIDATION_FAILED", "Choose a workspace member who can view this issue.");
    const where = { id: input.targetId, organizationId };
    const source = input.kind === "security" ? await tx.securityFinding.findFirst({ where, select: { title: true } }) : input.kind === "optimization" ? await tx.optimizationFinding.findFirst({ where, select: { title: true } }) : await tx.awsAccount.findFirst({ where, select: { displayName: true } }).then(a => a ? { title: `Connection help: ${a.displayName}` } : null);
    if (!source) throw notFound("Issue");
    const existing = await tx.helpRequest.findFirst({ where: { organizationId, kind: input.kind, targetId: input.targetId, assigneeId: input.assigneeId, status: "OPEN" } });
    if (existing) return existing;
    return tx.helpRequest.create({ data: { ...input, organizationId, requestedById: access.userId, title: source.title } });
  });
  await recordAudit({ action: AUDIT.HELP_CHANGED, organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "help_request", targetId: request.id, metadata: { op: "assign" } });
  return { id: request.id };
}
export async function getHelp(access: OrgAccess) {
  assertCan(access, "org:read");
  return getDb().helpRequest.findMany({ where: { organizationId: access.organizationId, kind: { in: HELP_KINDS.filter(k => access.can(HELP_PERMISSION[k])) } }, include: { assignee: { select: { name: true } } }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100 });
}
export async function completeHelp(access: OrgAccess, id: string, status: "OPEN" | "DONE") {
  const request = await getDb().helpRequest.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!request || !HELP_KINDS.includes(request.kind as HelpKind)) throw notFound("Help request");
  assertCan(access, HELP_PERMISSION[request.kind as HelpKind]);
  if (request.assigneeId !== access.userId && request.requestedById !== access.userId && !access.can("org:update")) throw new AppError("FORBIDDEN", "Only the requester, assignee or an administrator can update this request.");
  await getDb().helpRequest.update({ where: { id }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
  await recordAudit({ action: AUDIT.HELP_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "help_request", targetId: id, metadata: { status } });
}

export async function weeklySummary(access: OrgAccess, offset = 1, now = new Date()) {
  assertCan(access, "org:read");
  const db = getDb(), organizationId = access.organizationId, { start, end } = weekWindow(now, offset), period = { gte: start, lt: end };
  const previousStart = new Date(start.getTime() - 7 * 86400_000);
  const previousEnd = new Date(previousStart.getTime() + end.getTime() - start.getTime());
  const costWhere = { organizationId, awsAccount: { costScopeVersion: 1 }, granularity: "DAILY" as const, dimension: "TOTAL" as const };
  const [costs, previous, newIssues, resolvedIssues, completed, added, removed] = await Promise.all([
    access.can("cost:read") ? db.costRecord.groupBy({ by: ["unit"], where: { ...costWhere, periodStart: period }, _sum: { amount: true } }) : [],
    access.can("cost:read") ? db.costRecord.groupBy({ by: ["unit"], where: { ...costWhere, periodStart: { gte: previousStart, lt: previousEnd } }, _sum: { amount: true } }) : [],
    access.can("security:read") ? db.securityFinding.count({ where: { organizationId, firstSeenAt: period } }) : null,
    access.can("security:read") ? db.securityFinding.count({ where: { organizationId, resolvedAt: period, status: "RESOLVED" } }) : null,
    db.helpRequest.count({ where: { organizationId, status: "DONE", completedAt: period, kind: { in: HELP_KINDS.filter(k => access.can(HELP_PERMISSION[k])) } } }),
    access.can("inventory:read") ? db.awsResource.count({ where: { organizationId, firstSeenAt: period } }) : null,
    access.can("inventory:read") ? db.awsResource.count({ where: { organizationId, deletedAt: period } }) : null,
  ]);
  return { start, end, newIssues, resolvedIssues, completed, added, removed, costs: costs.map(c => ({ currency: c.unit, amount: Number(c._sum.amount ?? 0), previous: previous.some(p => p.unit === c.unit) ? Number(previous.find(p => p.unit === c.unit)!._sum.amount ?? 0) : null })) };
}

export async function getHelpTarget(access: OrgAccess, kind: HelpKind, id: string) {
  assertCan(access, HELP_PERMISSION[kind]);
  const where = { id, organizationId: access.organizationId }, db = getDb();
  const source = kind === "security" ? await db.securityFinding.findFirst({ where, select: { title: true } }) : kind === "optimization" ? await db.optimizationFinding.findFirst({ where, select: { title: true } }) : await db.awsAccount.findFirst({ where, select: { displayName: true } }).then(a => a ? { title: `Connection help: ${a.displayName}` } : null);
  return source ? { id, kind, title: source.title } : null;
}
