import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { reconcilePlan } from "@/server/aws/provisioning/service";
export const POST = orgRoute(
  {
    operation: "provisioning.reconcile",
    permission: "provisioning:configure",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    params: z.strictObject({ planId: z.uuid() }),
    body: z.strictObject({}),
  },
  async ({ access, params }) => reconcilePlan(access, params.planId),
);
