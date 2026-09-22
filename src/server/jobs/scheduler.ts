import "server-only";
import type { JobType } from "@/generated/prisma/client";
import { getDb } from "../db";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { enqueueJob } from "./queue";

/** How often each scheduled job type should run per connected account. */
export function scheduleIntervals(): Partial<Record<JobType, number>> {
  const inv = getEnv().SCHEDULED_SYNC_INTERVAL_MINUTES;
  if (inv === 0) return {};
  return {
    INVENTORY_SYNC: inv * 60_000,
    // Cost Explorer data refreshes ~daily and each request is billed by AWS.
    COST_SYNC: 12 * 60 * 60_000,
  };
}

/**
 * Enqueues due scheduled jobs. Safe to run concurrently on many workers: enqueue is deduplicated
 * by the partial unique index, and "due" is computed from the last finished job.
 */
export async function scheduleDueJobs(now = new Date()): Promise<number> {
  const intervals = scheduleIntervals();
  const db = getDb();
  const accounts = await db.awsAccount.findMany({
    where: { connection: { status: { in: ["CONNECTED", "NEEDS_ATTENTION", "PERMISSION_PROBLEM"] } } },
    select: { id: true, organizationId: true },
  });
  let enqueued = 0;
  for (const [type, intervalMs] of Object.entries(intervals) as [JobType, number][]) {
    for (const a of accounts) {
      const last = await db.syncJob.findFirst({
        where: { awsAccountRefId: a.id, type },
        orderBy: { createdAt: "desc" },
        select: { status: true, finishedAt: true, createdAt: true },
      });
      const active = last && (last.status === "QUEUED" || last.status === "RUNNING");
      const lastAt = last?.finishedAt ?? last?.createdAt;
      if (active || (lastAt && now.getTime() - lastAt.getTime() < intervalMs)) continue;
      const { deduplicated } = await enqueueJob({ organizationId: a.organizationId, awsAccountRefId: a.id, type, trigger: "SCHEDULED" });
      if (!deduplicated) enqueued++;
    }
  }
  if (enqueued > 0) logger.info("scheduled jobs enqueued", { enqueued });
  return enqueued;
}
