import { orgRoute } from "@/server/http/route";
import { getSyncJobs } from "@/server/services/sync-service";

export const GET = orgRoute({ operation: "sync.jobs", permission: "aws_accounts:read" }, async ({ access }) => ({
  jobs: await getSyncJobs(access),
}));
