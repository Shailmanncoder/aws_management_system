import { orgRoute } from "@/server/http/route";
import { triggerSync, triggerSyncInput } from "@/server/services/sync-service";

export const POST = orgRoute(
  { operation: "sync.trigger", permission: "sync:trigger", body: triggerSyncInput, rateLimit: "api" },
  async ({ access, body }) => ({ jobs: await triggerSync(access, body) }),
);
