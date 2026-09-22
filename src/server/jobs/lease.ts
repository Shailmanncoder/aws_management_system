import "server-only";
import type { Prisma, SyncJob } from "@/generated/prisma/client";

export class LeaseLostError extends Error {
  constructor() { super("Job lease lost"); this.name = "LeaseLostError"; }
}
export type WriteFence = (tx: Prisma.TransactionClient) => Promise<void>;

/** Locks the claim row until the data-write transaction commits. The attempt is a fencing token. */
export function jobWriteFence(job: SyncJob, workerId: string): WriteFence {
  return async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "sync_jobs"
      WHERE "id" = ${job.id}::uuid AND "organizationId" = ${job.organizationId}::uuid
      AND "lockedBy" = ${workerId} AND "attempts" = ${job.attempts}
      AND "status" = 'RUNNING' AND "leaseExpiresAt" > clock_timestamp()
      FOR UPDATE`;
    if (rows.length !== 1) throw new LeaseLostError();
  };
}
