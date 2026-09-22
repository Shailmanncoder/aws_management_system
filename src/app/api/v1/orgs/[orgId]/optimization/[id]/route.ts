import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { optimizationStateInput, setOptimizationState } from "@/server/services/optimization-service";
import { uuidSchema } from "@/server/validation/common";

export const PATCH = orgRoute(
  { operation: "optimization.state", permission: "optimization:manage", params: z.strictObject({ id: uuidSchema }), body: optimizationStateInput, rateLimit: "api" },
  async ({ access, params, body }) => {
    await setOptimizationState(access, params.id, body);
    return { ok: true };
  },
);
