import "server-only";
import type { JobType, SyncJob } from "@/generated/prisma/client";
import { getDb } from "../db";
import { isAppError } from "../errors";
import { runWithContext } from "../logging/context";
import { logger } from "../logging/logger";
import { recordJobOutcome } from "../observability/metrics";
import { AUDIT, recordAudit } from "../services/audit-service";
import { jobWriteFence, LeaseLostError, type WriteFence } from "./lease";
import { completeJob, heartbeat, retryOrFailJob } from "./queue";

export interface JobResult {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  errorSummary?: string | null;
  progress?: unknown;
  metrics?: unknown;
}

export type JobHandler = (job: SyncJob, ctx: { heartbeat: () => Promise<boolean>; fence: WriteFence }) => Promise<JobResult>;

const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

/** Retryable failures: throttling, transient AWS/DB unavailability. Auth/permission failures are not. */
function isRetryable(err: unknown): boolean {
  if (isAppError(err)) return ["AWS_THROTTLED", "AWS_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(err.code);
  return !(err instanceof TypeError || err instanceof RangeError);
}

/**
 * Executes one claimed job: idempotent handlers, observable (logs/metrics/audit), retryable.
 */
export async function runJob(job: SyncJob, workerId: string): Promise<JobResult | "retry" | "failed"> {
  return runWithContext(
    { requestId: `job-${job.id}`, jobId: job.id, organizationId: job.organizationId, awsAccountRef: job.awsAccountRefId ?? undefined, operation: `job.${job.type}` },
    async () => {
      const started = Date.now();
      const handler = handlers.get(job.type);
      const auditBase = {
        organizationId: job.organizationId,
        actorUserId: job.requestedById,
        actorType: job.requestedById ? ("USER" as const) : ("SYSTEM" as const),
        targetType: "sync_job",
        targetId: job.id,
      };
      if (!handler) {
        logger.error("no handler for job type", { type: job.type });
        await completeJob(job.id, workerId, { status: "FAILED", errorSummary: "Unsupported job type." });
        return "failed";
      }
      if (job.attempts === 1) {
        await recordAudit({ ...auditBase, action: AUDIT.SYNC_STARTED, outcome: "SUCCESS", metadata: { type: job.type, trigger: job.trigger } });
      }
      logger.info("job started", { type: job.type, attempt: job.attempts });
      let leaseLost = false;
      let renewal: Promise<void> = Promise.resolve();
      const renew = async () => {
        if (leaseLost) return false;
        try { if (!(await heartbeat(job.id, workerId, job.attempts))) leaseLost = true; }
        catch { leaseLost = true; }
        return !leaseLost;
      };
      const timer = setInterval(() => { renewal = renewal.then(async () => { await renew(); }); }, 30000);
      timer.unref();
      try {
        const fence = jobWriteFence(job, workerId);
        const result = await handler(job, { heartbeat: renew, fence: async (tx) => {
          if (leaseLost) throw new LeaseLostError();
          await fence(tx);
        } });
        if (leaseLost || !(await completeJob(job.id, workerId, result, job.attempts))) throw new LeaseLostError();
        recordJobOutcome(job.type, result.status, Date.now() - started);
        await recordAudit({
          ...auditBase,
          action: result.status === "FAILED" ? AUDIT.SYNC_FAILED : AUDIT.SYNC_COMPLETED,
          outcome: result.status === "FAILED" ? "FAILURE" : "SUCCESS",
          metadata: { type: job.type, status: result.status },
        });
        logger.info("job finished", { type: job.type, status: result.status, durationMs: Date.now() - started });
        return result;
      } catch (err) {
        if (err instanceof LeaseLostError || leaseLost) {
          logger.warn("worker stopped after losing job lease", { jobId: job.id });
          return "failed";
        }
        const summary = isAppError(err) ? err.publicMessage : "The job failed unexpectedly.";
        logger.error("job failed", { type: job.type, err });
        const outcome = await retryOrFailJob(job, workerId, summary, isRetryable(err));
        recordJobOutcome(job.type, outcome === "retry" ? "RETRY" : "FAILED", Date.now() - started);
        if (outcome === "failed") {
          await recordAudit({ ...auditBase, action: AUDIT.SYNC_FAILED, outcome: "FAILURE", metadata: { type: job.type } });
          if (job.awsAccountRefId && job.type === "INVENTORY_SYNC") {
            await getDb().awsAccount.updateMany({ where: { id: job.awsAccountRefId, organizationId: job.organizationId }, data: { syncStatus: "FAILED", syncError: summary } });
          }
        }
        return outcome;
      } finally {
        clearInterval(timer);
        await renewal;
      }
    },
  );
}
