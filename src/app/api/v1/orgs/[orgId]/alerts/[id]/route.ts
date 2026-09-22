import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { alertStateInput, setAlertState } from "@/server/services/alert-service";
import { uuidSchema } from "@/server/validation/common";

export const PATCH = orgRoute(
  { operation: "alerts.state", permission: "alerts:acknowledge", params: z.strictObject({ id: uuidSchema }), body: alertStateInput, rateLimit: "api" },
  async ({ access, params, body }) => {
    await setAlertState(access, params.id, body.status);
    return { ok: true };
  },
);
