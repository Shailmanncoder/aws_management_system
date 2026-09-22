import { orgRoute } from "@/server/http/route";
import { getPlan } from "@/server/aws/provisioning/service";
import { z } from "zod";
export const GET = orgRoute(
  {
    operation: "provisioning.getPlan",
    permission: "provisioning:create",
    rateLimit: "api",
    rateLimitBy: "org",
    params: z.strictObject({ planId: z.uuid() }),
  },
  async ({ access, params }) => getPlan(access, params.planId),
);
