import { orgRoute } from "@/server/http/route";
import { provisioningOptions } from "@/server/aws/provisioning/service";
export const GET = orgRoute(
  {
    operation: "provisioning.provisioningOptions",
    permission: "provisioning:create",
    rateLimit: "api",
    rateLimitBy: "org",
  },
  async ({ access }) => provisioningOptions(access),
);
