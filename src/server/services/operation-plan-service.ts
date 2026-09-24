import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { EC2Client, CreateTagsCommand, DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand, RebootInstancesCommand } from "@aws-sdk/client-ec2";
import { operationInput, stableJson, resourceSnapshot, type OperationInput } from "@/lib/operations";
import { assertCan, authorizeOrg, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { AppError, conflict, notFound } from "../errors";
import { jsonValue, operationsAudit, ownedResource } from "./operations-service";
import { assumeRoleSession, buildSessionName } from "../aws/sts";
import { decryptSecret } from "../security/envelope";
import { externalIdContext } from "./aws-session-service";
import { createAwsClient } from "../aws/client-factory";
import { awsMode } from "../aws/platform-credentials";

const digest = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
function reviewedSnapshot(r: Parameters<typeof resourceSnapshot>[0], scheduled: boolean) {
  const snapshot = resourceSnapshot(r);
  // Scheduled start/stop expects the running state to change; configuration must remain stable.
  return scheduled ? { ...snapshot, state: null } : snapshot;
}
export const actionRoleInput = z.strictObject({ accountId: z.uuid(), roleArn: z.string().regex(/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/), enabled: z.boolean() });
export async function configureActionRole(a: OrgAccess, input: z.infer<typeof actionRoleInput>) {
  assertCan(a, "actions:configure");
  const conn = await getDb().awsConnection.findFirst({ where: { organizationId: a.organizationId, awsAccountRefId: input.accountId }, include: { awsAccount: true } });
  if (!conn) throw notFound("Connection");
  if (!input.roleArn.startsWith(`arn:aws:iam::${conn.awsAccount.awsAccountId}:role/`) || input.roleArn === conn.roleArn) throw new AppError("VALIDATION_FAILED", "Use a separate action role in this AWS account.");
  await getDb().$transaction([
    getDb().awsConnection.updateMany({ where: { organizationId: a.organizationId, id: conn.id }, data: { actionRoleArn: input.roleArn } }),
    getDb().organization.update({ where: { id: a.organizationId }, data: { actionModeEnabled: input.enabled } }),
  ]);
  await operationsAudit(a, "operations.action-role.configured", conn.id);
  return { ok: true };
}
export async function createOperation(a: OrgAccess, raw: OperationInput) {
  assertCan(a, "actions:request");
  const input = operationInput.parse(raw);
  const now = Date.now();
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && (scheduledAt.getTime() <= now || scheduledAt.getTime() > now + 90 * 86400000)) throw new AppError("VALIDATION_FAILED", "Schedule within the next 90 days.");
  const snapshots = [];
  for (const id of input.resourceIds) {
    const r = await ownedResource(a, id);
    if (input.action !== "tag" && r.resourceType !== "ec2:instance") throw new AppError("VALIDATION_FAILED", "Lifecycle actions require EC2 instances.");
    if (input.action === "tag" && !["ec2:instance", "ec2:vpc", "ec2:subnet", "ec2:volume"].includes(r.resourceType)) throw new AppError("VALIDATION_FAILED", "Bulk tagging currently supports EC2 instances, VPCs, subnets and volumes.");
    snapshots.push({ id, name: r.name ?? r.resourceId, resourceId: r.resourceId, accountId: r.awsAccountRefId, region: r.region, hash: digest(reviewedSnapshot(r, !!scheduledAt)), before: resourceSnapshot(r) });
  }
  const row = await getDb().operationPlan.create({ data: { organizationId: a.organizationId, userId: a.userId, name: input.name, payload: jsonValue({ ...input, snapshots }), scheduledAt, expiresAt: new Date((scheduledAt?.getTime() ?? now) + (scheduledAt ? 15 * 60000 : 86400000)) } });
  await operationsAudit(a, "operations.plan.requested", row.id);
  return row;
}
export async function transitionOperation(a: OrgAccess, id: string, action: "approve" | "reject" | "cancel" | "execute") {
  assertCan(a, "actions:request");
  const db = getDb();
  const plan = await db.operationPlan.findFirst({ where: { organizationId: a.organizationId, id } });
  if (!plan) throw notFound("Operation");
  if (action === "execute") return executeOperation(a, id);
  if (action === "approve" || action === "reject") {
    assertCan(a, "org:update");
    if (plan.userId === a.userId && action === "approve") throw conflict("A different administrator must approve this request.");
  } else if (a.userId !== plan.userId && !a.can("org:update")) throw new AppError("FORBIDDEN", "Only the requester or an administrator can cancel this request.");
  const result = await db.operationPlan.updateMany({ where: { organizationId: a.organizationId, id, status: { in: action === "cancel" ? ["PENDING", "APPROVED"] : ["PENDING"] }, expiresAt: { gt: new Date() } }, data: { status: action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "CANCELLED", ...(action === "approve" ? { approvedBy: a.userId, approvedAt: new Date() } : {}) } });
  if (!result.count) throw conflict("This request is no longer available for that action.");
  await operationsAudit(a, `operations.plan.${action}`, id);
  return { ok: true };
}
export async function executeOperation(caller: OrgAccess, id: string, scheduled = false) {
  assertCan(caller, "actions:request");
  const db = getDb(), organizationId = caller.organizationId;
  const plan = await db.operationPlan.findFirst({ where: { organizationId, id } });
  if (!plan || !plan.approvedBy) throw notFound("Approved operation");
  if (plan.status !== "APPROVED" || plan.expiresAt <= new Date()) throw conflict("The approved request has expired or already ran.");
  if (plan.scheduledAt && (!scheduled || plan.scheduledAt > new Date())) throw conflict("This request will run at its scheduled time.");
  const requester = await authorizeOrg(plan.userId, organizationId, "actions:request");
  await authorizeOrg(plan.approvedBy, organizationId, "org:update");
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!org.actionModeEnabled || awsMode() !== "live") throw new AppError("PRECONDITION_FAILED", "Enable action mode and configure a separate action role in live AWS mode before execution.");
  const payload = plan.payload as unknown as OperationInput & { snapshots: { id: string; hash: string }[] };
  const input = operationInput.parse(payloadWithoutSnapshots(payload));
  const resources = await Promise.all(input.resourceIds.map(id => ownedResource(requester, id)));
  for (const r of resources) {
    const expected = payload.snapshots.find(s => s.id === r.id);
    if (!expected || expected.hash !== digest(reviewedSnapshot(r, !!plan.scheduledAt))) throw conflict("Inventory changed after review. Create a new request.");
  }
  const claimed = await db.operationPlan.updateMany({ where: { organizationId, id, status: "APPROVED" }, data: { status: "RUNNING" } });
  if (!claimed.count) throw conflict("This operation was already claimed.");
  const results: { resourceId: string; status: string; message: string }[] = [];
  for (const r of resources) {
    try {
      // Recheck both identities for every resource, including scheduled execution.
      await authorizeOrg(plan.userId, organizationId, "actions:request");
      await authorizeOrg(plan.approvedBy, organizationId, "org:update");
      const enabled = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { actionModeEnabled: true } });
      if (!enabled.actionModeEnabled) throw new AppError("PRECONDITION_FAILED", "Action mode was disabled.");
      const conn = await db.awsConnection.findFirst({ where: { organizationId, awsAccountRefId: r.awsAccountRefId }, include: { awsAccount: true } });
      if (!conn || !conn.actionRoleArn || conn.actionRoleArn === conn.roleArn || conn.method !== "ASSUME_ROLE" || conn.status !== "CONNECTED") throw new AppError("PRECONDITION_FAILED", "A connected account with a separate action role is required.");
      const session = await assumeRoleSession({ roleArn: conn.actionRoleArn, externalId: await decryptSecret(conn.externalIdEnc, externalIdContext(organizationId, conn.awsAccountRefId)), sessionName: buildSessionName("operations", id.slice(0, 8)), expectedAccountId: conn.awsAccount.awsAccountId, partition: conn.awsAccount.partition });
      try {
        const client = createAwsClient(EC2Client, session, r.region, "ec2", { maxAttempts: 1 });
        try {
        if (input.action === "tag") {
          await client.send(new CreateTagsCommand({ Resources: [r.resourceId], Tags: input.tags.map(t => ({ Key: t.key, Value: t.value })) }));
        } else {
          const current = await client.send(new DescribeInstancesCommand({ InstanceIds: [r.resourceId] }));
          const state = current.Reservations?.[0]?.Instances?.[0]?.State?.Name;
          const required = input.action === "start" ? "stopped" : "running";
          if (state !== required) throw new AppError("PRECONDITION_FAILED", `AWS reports ${state ?? "unknown"}; this action requires ${required}.`);
          const command = input.action === "start" ? new StartInstancesCommand({ InstanceIds: [r.resourceId] }) : input.action === "stop" ? new StopInstancesCommand({ InstanceIds: [r.resourceId] }) : new RebootInstancesCommand({ InstanceIds: [r.resourceId] });
          await client.send(command);
        }
        } finally { client.destroy(); }
      } finally { session.dispose(); }
      results.push({ resourceId: r.id, status: "ACCEPTED", message: "AWS accepted the request. Run a sync to confirm the resulting state." });
    } catch (error) {
      results.push({ resourceId: r.id, status: "CHECK_REQUIRED", message: error instanceof AppError ? error.publicMessage : "Execution could not be confirmed. Inspect AWS before creating another request." });
    }
    await db.operationPlan.updateMany({ where: { organizationId, id, status: "RUNNING" }, data: { result: jsonValue(results) } });
  }
  await db.operationPlan.updateMany({ where: { organizationId, id, status: "RUNNING" }, data: { status: results.every(r => r.status === "ACCEPTED") ? "SUCCEEDED" : "CHECK_REQUIRED", result: jsonValue(results) } });
  await operationsAudit(caller, "operations.plan.executed", id);
  return { results };
}
function payloadWithoutSnapshots(p: OperationInput & { snapshots: unknown }) {
  const { snapshots: _, ...input } = p; void _; return input;
}
export async function runScheduledOperations(now = new Date()) {
  const db = getDb();
  await db.operationPlan.updateMany({ where: { status: { in: ["PENDING", "APPROVED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  // A crashed or interrupted write must be inspected, never automatically replayed.
  await db.operationPlan.updateMany({ where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - 30 * 60000) } }, data: { status: "CHECK_REQUIRED" } });
  const due = await db.operationPlan.findMany({ where: { status: "APPROVED", scheduledAt: { lte: now }, expiresAt: { gt: now } }, take: 20 });
  for (const plan of due) {
    try { await executeOperation(await authorizeOrg(plan.userId, plan.organizationId, "actions:request"), plan.id, true); }
    catch { await db.operationPlan.updateMany({ where: { id: plan.id, organizationId: plan.organizationId, status: "APPROVED" }, data: { status: "CHECK_REQUIRED", result: { message: "Scheduled execution was blocked. Review permissions, action setup, and resource changes." } } }); }
  }
}
