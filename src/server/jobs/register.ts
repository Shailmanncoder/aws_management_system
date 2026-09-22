import "server-only";
import { registerPostSyncAnalyzer } from "../sync/post-sync";
import { getDb } from "../db";
import { evaluateAlerts } from "../services/alert-service";
import { runOptimizationAnalysis } from "../sync/optimization-sync";
import { runSecurityScan } from "../sync/security-sync";
import { runCostSync } from "../sync/cost-sync";
import { runInventorySync } from "../sync/inventory-sync";
import { registerJobHandler } from "./runner";

/** Wires job types to handlers. Imported once by the worker (and tests). */
let registered = false;

export function registerAllJobHandlers(): void {
  if (registered) return;
  registered = true;
  registerPostSyncAnalyzer({ name: "security", run: runSecurityScan });
  registerPostSyncAnalyzer({ name: "optimization", run: runOptimizationAnalysis });
  registerPostSyncAnalyzer({
    name: "alerts",
    run: async (ctx) => {
      // "New" = since the previous completed inventory sync. The first sync only establishes a
      // baseline (otherwise every pre-existing finding would alert at once).
      const prev = await getDb().syncJob.findFirst({
        where: { organizationId: ctx.organizationId, awsAccountRefId: ctx.accountRefId, type: "INVENTORY_SYNC", status: { in: ["SUCCEEDED", "PARTIAL"] }, finishedAt: { not: null } },
        orderBy: { finishedAt: "desc" },
        select: { startedAt: true },
      });
      await evaluateAlerts(ctx.organizationId, ctx.accountRefId, prev?.startedAt ?? new Date());
    },
  });
  registerJobHandler("INVENTORY_SYNC", async (job, ctx) => runInventorySync(job, { heartbeat: ctx.heartbeat, fence: ctx.fence }));
  registerJobHandler("COST_SYNC", async (job, ctx) => {
    const result = await runCostSync(job, ctx.fence);
    // Cost rules (threshold / anomaly) are evaluated as soon as fresh cost data lands.
    if (result.status !== "FAILED" && job.awsAccountRefId) await evaluateAlerts(job.organizationId, job.awsAccountRefId, new Date());
    return result;
  });
}
