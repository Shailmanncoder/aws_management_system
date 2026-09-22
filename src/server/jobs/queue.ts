import "server-only";
import { Prisma, type JobStatus, type JobTrigger, type JobType, type SyncJob } from "@/generated/prisma/client";
import { getDb } from "../db";
import { logger } from "../logging/logger";

/**
 * PostgreSQL-backed job queue.
 *
 * Guarantees:
 *  - Dedupe: a partial UNIQUE index allows at most one QUEUED/RUNNING job per (account, type);
 *    concurrent enqueue attempts collapse onto the existing job.
 *  - Exclusive claim: `FOR UPDATE SKIP LOCKED` — two workers can never claim the same job.
 *  - Leases: a RUNNING job whose lease expired (crashed worker) is reclaimed by another worker.
 *  - Fencing: completion/heartbeat only succeed if `lockedBy` still matches, so a worker whose
 *    lease was reclaimed cannot overwrite the new owner's result.
 */

export const LEASE_MS = 2 * 60 * 1000;

export interface EnqueueInput {
  organizationId: string;
  awsAccountRefId: string | null;
  type: JobType;
  trigger: JobTrigger;
  requestedById?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueueJob(input: EnqueueInput): Promise<{ job: SyncJob; deduplicated: boolean }> {
  const db = getDb();
  try {
    const job = await db.syncJob.create({
      data: {
        organizationId: input.organizationId,
        awsAccountRefId: input.awsAccountRefId,
        type: input.type,
        trigger: input.trigger,
        requestedById: input.requestedById ?? null,
        runAfter: input.runAfter ?? new Date(),
        maxAttempts: input.maxAttempts ?? 3,
      },
    });
    return { job, deduplicated: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.syncJob.findFirst({
        where: {
          organizationId: input.organizationId,
          awsAccountRefId: input.awsAccountRefId,
          type: input.type,
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });
      if (existing) return { job: existing, deduplicated: true };
    }
    throw err;
  }
}

/** Atomically claims the next runnable job (or an expired lease). */
export async function claimNextJob(workerId: string, opts: { types?: JobType[]; organizationId?: string } = {}): Promise<SyncJob | null> {
  const leaseUntil = new Date(Date.now() + LEASE_MS);
  const typeFilter = opts.types && opts.types.length > 0 ? Prisma.sql`AND "type"::text IN (${Prisma.join(opts.types)})` : Prisma.empty;
  const orgFilter = opts.organizationId ? Prisma.sql`AND "organizationId" = ${opts.organizationId}::uuid` : Prisma.empty;
  const rows = await getDb().$queryRaw<SyncJob[]>`
    UPDATE "sync_jobs" SET
      "status" = 'RUNNING',
      "lockedBy" = ${workerId},
      "leaseExpiresAt" = ${leaseUntil},
      "startedAt" = COALESCE("startedAt", now()),
      "attempts" = "attempts" + 1,
      "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "sync_jobs"
      WHERE ((
        "status" = 'QUEUED' AND "runAfter" <= now()
      ) OR (
        "status" = 'RUNNING' AND "leaseExpiresAt" < now()
      )) ${typeFilter} ${orgFilter}
      ORDER BY "runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function heartbeat(jobId: string, workerId: string, attempt?: number): Promise<boolean> {
  const res = await getDb().syncJob.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "RUNNING", ...(attempt === undefined ? {} : { attempts: attempt }), leaseExpiresAt: { gt: new Date() } },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return res.count === 1;
}

export async function completeJob(
  jobId: string,
  workerId: string,
  outcome: { status: Extract<JobStatus, "SUCCEEDED" | "PARTIAL" | "FAILED">; errorSummary?: string | null; progress?: unknown; metrics?: unknown },
  attempt?: number,
): Promise<boolean> {
  const res = await getDb().syncJob.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "RUNNING", ...(attempt === undefined ? {} : { attempts: attempt }), leaseExpiresAt: { gt: new Date() } },
    data: {
      status: outcome.status,
      errorSummary: outcome.errorSummary ?? null,
      progress: (outcome.progress ?? undefined) as Prisma.InputJsonValue | undefined,
      metrics: (outcome.metrics ?? undefined) as Prisma.InputJsonValue | undefined,
      finishedAt: new Date(),
      lockedBy: null,
      leaseExpiresAt: null,
    },
  });
  if (res.count !== 1) logger.warn("job completion fenced out (lease lost)", { jobId });
  return res.count === 1;
}

/** Retry with exponential backoff (+jitter) or fail permanently when attempts are exhausted. */
export async function retryOrFailJob(job: SyncJob, workerId: string, errorSummary: string, retryable: boolean): Promise<"retry" | "failed"> {
  const db = getDb();
  if (retryable && job.attempts < job.maxAttempts) {
    const delay = Math.min(30 * 60_000, 30_000 * 2 ** (job.attempts - 1)) * (0.5 + Math.random() / 2);
    const res = await db.syncJob.updateMany({
      where: { id: job.id, lockedBy: workerId, status: "RUNNING", attempts: job.attempts, leaseExpiresAt: { gt: new Date() } },
      data: { status: "QUEUED", runAfter: new Date(Date.now() + delay), errorSummary, lockedBy: null, leaseExpiresAt: null },
    });
    if (res.count === 1) return "retry";
  }
  await completeJob(job.id, workerId, { status: "FAILED", errorSummary }, job.attempts);
  return "failed";
}

export async function listRecentJobs(organizationId: string, limit = 20) {
  return getDb().syncJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      trigger: true,
      attempts: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      errorSummary: true,
      progress: true,
      metrics: true,
      awsAccount: { select: { id: true, displayName: true, awsAccountId: true } },
    },
  });
}
