import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { findingStateInput, setFindingState } from "@/server/services/findings-service";
import { uuidSchema } from "@/server/validation/common";

export const PATCH = orgRoute({ operation: "security.status", permission: "security:manage", rateLimit: "api",
  params: z.object({ id: uuidSchema }).strict(), body: findingStateInput,
}, async ({ access, params, body }) => {
  await setFindingState(access, params.id, body);
  return { ok: true };
});
