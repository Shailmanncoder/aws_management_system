import { orgRoute } from "@/server/http/route";
import { applyPlan } from "@/server/aws/provisioning/service";
import { applyInput } from "@/lib/provisioning";
import { z } from "zod";
export const POST = orgRoute(
  {
    operation: "provisioning.applyPlan",
    permission: "provisioning:create",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    body: applyInput,
    params: z.strictObject({ planId: z.uuid() }),
  },
  async ({ access, params, body }) => applyPlan(access, params.planId, body),
);
