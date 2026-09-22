import "server-only";
import { z } from "zod";
import type { JobType, Prisma } from "@/generated/prisma/client";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { AppError, notFound } from "../errors";
import { enqueueJob, listRecentJobs } from "../jobs/queue";
import { enforceRateLimit } from "../security/rate-limit";
import { uuidSchema } from "../validation/common";

export const triggerSyncInput = z.strictObject({
  accountId: uuidSchema.optional(),
  type: z.enum(["INVENTORY_SYNC", "COST_SYNC"]).default("INVENTORY_SYNC"),
});

const SYNCABLE = ["CONNECTED", "NEEDS_ATTENTION", "PERMISSION_PROBLEM", "ROLE_UNAVAILABLE"] as const;

/** Manual refresh. Rate-limited per AWS account; duplicate requests collapse onto the active job. */
export async function triggerSync(access: OrgAccess, input: z.infer<typeof triggerSyncInput>) {
  assertCan(access, "sync:trigger");
  const db = getDb();
  const accounts = await db.awsAccount.findMany({
    where: { organizationId: access.organizationId, ...(input.accountId ? { id: input.accountId } : {}) },
    select: { id: true, connection: { select: { status: true } } },
  });
  if (input.accountId && accounts.length === 0) throw notFound("AWS account");
  const eligible = accounts.filter((a) => a.connection && (SYNCABLE as readonly string[]).includes(a.connection.status));
  if (eligible.length === 0) throw new AppError("PRECONDITION_FAILED", "No connected AWS accounts to synchronize.");

  const jobs = [];
  for (const a of eligible) {
    await enforceRateLimit(input.type === "COST_SYNC" ? "manualCostSync" : "manualSync", `account:${a.id}:${input.type}`);
    const { job, deduplicated } = await enqueueJob({
      organizationId: access.organizationId,
      awsAccountRefId: a.id,
      type: input.type as JobType,
      trigger: "MANUAL",
      requestedById: access.userId,
    });
    if (!deduplicated && input.type === "INVENTORY_SYNC") {
      await db.awsAccount.updateMany({ where: { id: a.id, organizationId: access.organizationId }, data: { syncStatus: "QUEUED" } });
    }
    jobs.push({ id: job.id, accountId: a.id, status: job.status, deduplicated });
  }
  return jobs;
}

/** Enqueues the first inventory + cost sync right after a successful connection. */
export async function enqueueInitialSync(organizationId: string, accountRefId: string, requestedById: string) {
  for (const type of ["INVENTORY_SYNC", "COST_SYNC"] as const) {
    await enqueueJob({ organizationId, awsAccountRefId: accountRefId, type, trigger: "SYSTEM", requestedById });
  }
  await getDb().awsAccount.updateMany({ where: { id: accountRefId, organizationId }, data: { syncStatus: "QUEUED" } });
  // First connection: enable the recommended in-app alert rules (users can change them later).
  const db = getDb();
  if ((await db.alertRule.count({ where: { organizationId } })) === 0) {
    const { RECOMMENDED_RULES } = await import("./alert-service");
    await db.alertRule.createMany({
      data: RECOMMENDED_RULES.map((r) => ({ organizationId, type: r.type, name: r.name, enabled: r.enabled, config: r.config as Prisma.InputJsonValue, channels: ["IN_APP"], createdById: requestedById })),
    });
  }
}

export async function getSyncJobs(access: OrgAccess) {
  assertCan(access, "aws_accounts:read");
  return listRecentJobs(access.organizationId, 30);
}
