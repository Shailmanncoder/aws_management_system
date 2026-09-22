import { orgRoute } from "@/server/http/route";
import {
  enableProvisioning,
  toggleSchema,
} from "@/server/aws/provisioning/service";
import { z } from "zod";
export const POST = orgRoute(
  {
    operation: "provisioning.enableProvisioning",
    permission: "provisioning:configure",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    body: toggleSchema,
    params: z.strictObject({ accountId: z.uuid() }),
  },
  async ({ access, params, body }) =>
    enableProvisioning(access, params.accountId, body.enabled),
);
