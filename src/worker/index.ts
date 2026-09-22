/**
 * Stratus background worker. Runs separately from the web tier (own container / ECS service).
 *
 *   node dist/worker.mjs
 *
 * - claims jobs with SKIP LOCKED (safe to run many replicas)
 * - bounded concurrency (WORKER_CONCURRENCY)
 * - schedules periodic syncs and housekeeping
 * - graceful shutdown on SIGTERM/SIGINT: stops claiming, lets in-flight jobs finish
 */
import { createServer } from "node:http";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { getDb } from "../server/db";
import { verifyPlatformIdentity } from "../server/aws/platform-identity";
import { getEnv } from "../server/env";
import { claimNextJob } from "../server/jobs/queue";
import { registerAllJobHandlers } from "../server/jobs/register";
import { runJob } from "../server/jobs/runner";
import { scheduleDueJobs } from "../server/jobs/scheduler";
import { logger } from "../server/logging/logger";
import { snapshotMetrics } from "../server/observability/metrics";
import { purgeExpiredRateLimitBuckets } from "../server/security/rate-limit";

process.env.STRATUS_SERVICE = "worker";

async function main() {
  const env = getEnv(); // fail fast on invalid configuration
  await verifyPlatformIdentity(); // live mode: refuse root / mismatched platform credentials
  registerAllJobHandlers();
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let stopping = false;
  const inflight = new Set<Promise<unknown>>();

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("worker stopping", { signal, inflight: inflight.size });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  let lastLoopAt = Date.now();
  if (env.WORKER_HEALTH_PORT > 0) {
    // Liveness only: reports whether the poll loop is progressing. Exposes no data.
    createServer((req, res) => {
      const healthy = !stopping && Date.now() - lastLoopAt < 5 * 60_000;
      res.writeHead(req.url === "/healthz" && healthy ? 200 : 503, { "content-type": "text/plain" }).end(healthy ? "ok" : "unhealthy");
    }).listen(env.WORKER_HEALTH_PORT);
  }

  logger.info("worker started", { workerId, concurrency: env.WORKER_CONCURRENCY, awsMode: env.AWS_MODE });

  let lastSchedule = 0;
  let lastHousekeeping = 0;
  let lastMetrics = Date.now();

  while (!stopping) {
    const now = Date.now();
    lastLoopAt = now;
    try {
      if (now - lastSchedule > 60_000) {
        lastSchedule = now;
        await scheduleDueJobs();
      }
      if (now - lastHousekeeping > 10 * 60_000) {
        lastHousekeeping = now;
        await purgeExpiredRateLimitBuckets();
      }
      if (now - lastMetrics > 5 * 60_000) {
        lastMetrics = now;
        logger.info("worker metrics", { metrics: snapshotMetrics() });
      }

      if (inflight.size < env.WORKER_CONCURRENCY) {
        const job = await claimNextJob(workerId);
        if (job) {
          const p = runJob(job, workerId).finally(() => inflight.delete(p));
          inflight.add(p);
          continue; // try to fill remaining slots immediately
        }
      }
    } catch (err) {
      // e.g. database temporarily unavailable: back off and keep going.
      logger.error("worker loop error", { err });
    }
    await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS));
  }

  await Promise.allSettled([...inflight]);
  await getDb().$disconnect();
  logger.info("worker stopped");
}

main().catch((err: unknown) => {
  logger.error("worker crashed", { err });
  process.exit(1);
});
