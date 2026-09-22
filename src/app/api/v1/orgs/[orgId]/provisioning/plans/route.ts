import { orgRoute } from "@/server/http/route";
import { makePlan, recentPlans } from "@/server/aws/provisioning/service";
import { planInput } from "@/lib/provisioning";
export const POST = orgRoute(
  {
    operation: "provisioning.makePlan",
    permission: "provisioning:create",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    body: planInput,
  },
  async ({ access, body }) => makePlan(access, body),
);

export const GET = orgRoute(
  {
    operation: "provisioning.history",
    permission: "provisioning:create",
    rateLimit: "api",
  },
  async ({ access }) => recentPlans(access),
);
