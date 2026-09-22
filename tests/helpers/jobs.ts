import { claimNextJob } from "@/server/jobs/queue";
import { registerAllJobHandlers } from "@/server/jobs/register";
import { runJob } from "@/server/jobs/runner";

/** Drains queued jobs for one org by running them through the real worker path. */
export async function drainJobs(organizationId: string, max = 20) {
  registerAllJobHandlers();
  const results = [];
  for (let i = 0; i < max; i++) {
    // Scoped to this test's organization so other test files' jobs are never picked up.
    const job = await claimNextJob("test-worker", { organizationId });
    if (!job) break;
    results.push({ job, result: await runJob(job, "test-worker") });
  }
  return results;
}
