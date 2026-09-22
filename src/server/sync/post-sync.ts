import "server-only";
import { LeaseLostError, type WriteFence } from "../jobs/lease";
import type { AwsSession } from "../aws/session";
import { logger } from "../logging/logger";

export interface PostSyncContext {
  organizationId: string;
  accountRefId: string;
  session: AwsSession;
  regions: string[];
  inventoryStartedAt: Date;
  inventoryGaps?: string[];
  heartbeat: () => Promise<boolean>;
  fence?: WriteFence;
}

export type PostSyncAnalyzer = { name: string; run: (ctx: PostSyncContext) => Promise<void> };

const analyzers: PostSyncAnalyzer[] = [];

/** Registered by the security, optimisation and alerting modules. */
export function registerPostSyncAnalyzer(a: PostSyncAnalyzer): void {
  if (!analyzers.some((x) => x.name === a.name)) analyzers.push(a);
}

/**
 * Runs analyzers sequentially. A failing analyzer is logged and does not fail the sync — the
 * inventory itself was persisted successfully.
 */
export async function runPostSyncAnalyzers(ctx: PostSyncContext): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const a of analyzers) {
    try {
      await a.run(ctx);
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      failed.push(a.name);
      logger.error("post-sync analyzer failed", { analyzer: a.name, err });
    }
  }
  return { failed };
}
