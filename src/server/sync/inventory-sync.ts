import "server-only";
import { LeaseLostError, type WriteFence } from "../jobs/lease";
export { LeaseLostError } from "../jobs/lease";
import type { SyncJob } from "@/generated/prisma/client";
import { COLLECTORS } from "../aws/collectors";
import type { Collector } from "../aws/collectors/types";
import { mapSettledLimit } from "../aws/concurrency";
import { awsErrorCode, classifyAwsError } from "../aws/errors";
import { withRetry } from "../aws/retry";
import { getDb } from "../db";
import { getEnv } from "../env";
import { AppError, isAppError } from "../errors";
import { logger } from "../logging/logger";
import { openAwsSession } from "../services/aws-session-service";
import { persistCollectorResult } from "./persist";
import { runPostSyncAnalyzers } from "./post-sync";

export type TaskStatus = "ok" | "denied" | "skipped" | "failed";

export interface TaskProgress {
  collector: string;
  region: string;
  status: TaskStatus;
  count: number;
  message?: string;
}

export interface SyncOutcome {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  errorSummary: string | null;
  progress: TaskProgress[];
  metrics: { resources: number; markedDeleted: number; tasks: number; retries: number; durationMs: number; regions: number };
}

export interface SyncDeps {
  /** Extends the job lease; returns false if another worker took over. */
  heartbeat: () => Promise<boolean>;
  collectors?: readonly Collector[];
  fence?: WriteFence;
}

function summarize(progress: TaskProgress[]): { status: SyncOutcome["status"]; errorSummary: string | null } {
  const failed = progress.filter((p) => p.status === "failed");
  const denied = progress.filter((p) => p.status === "denied");
  const attempted = progress.filter((p) => p.status !== "skipped");
  if (attempted.length > 0 && failed.length + denied.length === attempted.length) {
    return { status: "FAILED", errorSummary: "Resource synchronization failed for every service and region. Check the connection diagnostics." };
  }
  if (failed.length === 0 && denied.length === 0) return { status: "SUCCEEDED", errorSummary: null };
  const parts: string[] = [];
  if (failed.length) {
    const regions = [...new Set(failed.map((f) => f.region))].slice(0, 5).join(", ");
    parts.push(`${failed.length} task(s) failed (${regions})`);
  }
  if (denied.length) {
    const actions = [...new Set(denied.map((d) => d.message?.replace("Missing required AWS permission: ", "")))].slice(0, 5).join(", ");
    parts.push(`missing permission(s): ${actions}`);
  }
  return { status: "PARTIAL", errorSummary: `Resource synchronization partially completed: ${parts.join("; ")}.` };
}

export async function runInventorySync(job: SyncJob, deps: SyncDeps): Promise<SyncOutcome> {
  if (!job.awsAccountRefId) throw new AppError("VALIDATION_FAILED", "Inventory sync requires an AWS account.");
  const organizationId = job.organizationId;
  const accountRefId = job.awsAccountRefId;
  const db = getDb();
  const env = getEnv();
  const started = new Date();
  const collectors = deps.collectors ?? COLLECTORS;

  await db.$transaction(async (tx) => { await deps.fence?.(tx); await tx.awsAccount.updateMany({ where: { id: accountRefId, organizationId }, data: { syncStatus: "RUNNING" } }); });

  let opened;
  try {
    opened = await openAwsSession(organizationId, accountRefId, "sync");
  } catch (err) {
    const message = isAppError(err) ? err.publicMessage : "AWS role could not be assumed.";
    if (isAppError(err) && err.code === "AWS_ROLE_UNAVAILABLE") {
      await db.awsConnection.updateMany({
        where: { organizationId, awsAccountRefId: accountRefId },
        data: { status: "ROLE_UNAVAILABLE", statusMessage: "AWS role could not be assumed during sync. Re-validate the connection." },
      });
    }
    await db.awsAccount.updateMany({ where: { id: accountRefId, organizationId }, data: { syncStatus: "FAILED", syncError: message } });
    throw err;
  }

  const { session, regions, awsAccountId } = opened;
  const progress: TaskProgress[] = [];
  let resources = 0;
  let markedDeleted = 0;
  let retries = 0;
  const scope = { organizationId, awsAccountRefId: accountRefId, awsAccountId };

  const runTask = async (collector: Collector, region: string | null): Promise<void> => {
    const label = region ?? "global";
    try {
      const out = await withRetry(() => collector.collect({ session, region: region ?? env.PLATFORM_AWS_REGION, accountId: awsAccountId }), {
        onRetry: () => {
          retries++;
        },
      });
      if (!(await deps.heartbeat())) throw new LeaseLostError();
      const persisted = await persistCollectorResult(scope, { resources: out, resourceTypes: collector.resourceTypes, region }, started, deps.fence);
      resources += persisted.upserted;
      markedDeleted += persisted.markedDeleted;
      progress.push({ collector: collector.id, region: label, status: "ok", count: persisted.upserted });
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      const cls = classifyAwsError(err);
      if (cls === "access_denied") {
        progress.push({ collector: collector.id, region: label, status: "denied", count: 0, message: `Missing required AWS permission: ${collector.iamAction}` });
      } else if (cls === "not_enabled" || cls === "region_unavailable") {
        progress.push({ collector: collector.id, region: label, status: "skipped", count: 0, message: "Service or region not enabled." });
      } else {
        logger.warn("collector failed", { collector: collector.id, region: label, errorCode: awsErrorCode(err), errorClass: cls });
        const message = cls === "throttled" ? "AWS API request was throttled." : cls === "service_unavailable" ? "AWS API unavailable in this region." : "AWS API request failed.";
        progress.push({ collector: collector.id, region: label, status: "failed", count: 0, message });
      }
    }
    if (!(await deps.heartbeat())) throw new LeaseLostError();
  };

  try {
    const regional = collectors.filter((c) => c.scope === "regional");
    const global = collectors.filter((c) => c.scope === "global");

    const regionResults = await mapSettledLimit(regions, env.AWS_REGION_CONCURRENCY, (region) =>
      mapSettledLimit(regional, env.AWS_SERVICE_CONCURRENCY, (c) => runTask(c, region)),
    );
    const globalResults = await mapSettledLimit(global, env.AWS_SERVICE_CONCURRENCY, (c) => runTask(c, null));
    const leaseLost = [...regionResults.flatMap((r) => (r.status === "fulfilled" ? r.value : [r])), ...globalResults].some(
      (r) => r.status === "rejected" && r.reason instanceof LeaseLostError,
    );
    if (leaseLost) throw new LeaseLostError();

    const { status, errorSummary } = regions.length === 0
      ? { status: "FAILED" as const, errorSummary: "No enabled regions were discovered. Re-validate the connection." }
      : summarize(progress);

    await db.$transaction(async (tx) => { await deps.fence?.(tx); await tx.awsAccount.updateMany({
      where: { id: accountRefId, organizationId },
      data: { syncStatus: status, syncError: errorSummary, ...(status !== "FAILED" ? { lastSyncedAt: new Date() } : {}) },
    }); });
    if (status !== "FAILED") {
      const analysis = await runPostSyncAnalyzers({ organizationId, accountRefId, session, regions, inventoryStartedAt: started, inventoryGaps: progress.filter((p) => p.status === "failed" || p.status === "denied").map((p) => `${p.collector}: ${p.region}`), heartbeat: deps.heartbeat, fence: deps.fence });
      if (analysis.failed.length) {
        progress.push({ collector: "security-analysis", region: "global", status: "failed", count: 0, message: "Security analysis incomplete; previous findings retained." });
      }
    }
    await db.$transaction(async (tx) => { await deps.fence?.(tx); await tx.organization.update({ where: { id: organizationId }, data: { inventoryVersion: { increment: 1 } } }); });

    const final = summarize(progress);
    if (status !== "FAILED" && final.status !== status) {
      await db.$transaction(async (tx) => { await deps.fence?.(tx); await tx.awsAccount.updateMany({ where: { id: accountRefId, organizationId }, data: { syncStatus: final.status, syncError: final.errorSummary } }); });
    }
    return {
      status: status === "FAILED" ? status : final.status,
      errorSummary: status === "FAILED" ? errorSummary : final.errorSummary,
      progress,
      metrics: { resources, markedDeleted, tasks: progress.length, retries, durationMs: Date.now() - started.getTime(), regions: regions.length },
    };
  } finally {
    session.dispose();
  }
}
