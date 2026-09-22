import { orgRoute } from "@/server/http/route";
import { setupProvisioning } from "@/server/aws/provisioning/service";
import { z } from "zod";
export const POST = orgRoute(
  {
    operation: "provisioning.setupProvisioning",
    permission: "provisioning:configure",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    body: z.strictObject({}),
    params: z.strictObject({ accountId: z.uuid() }),
  },
  async ({ access, params }) => setupProvisioning(access, params.accountId),
);
