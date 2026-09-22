import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { deleteAlertRule, updateAlertRule } from "@/server/services/alert-service";
import { uuidSchema } from "@/server/validation/common";

const params = z.strictObject({ id: uuidSchema });

export const PATCH = orgRoute(
  { operation: "alert_rules.update", permission: "alerts:manage", params, body: z.strictObject({ enabled: z.boolean().optional(), name: z.string().trim().min(2).max(80).optional() }), rateLimit: "api" },
  async ({ access, params: p, body }) => {
    await updateAlertRule(access, p.id, body);
    return { ok: true };
  },
);

export const DELETE = orgRoute({ operation: "alert_rules.delete", permission: "alerts:manage", params, rateLimit: "api" }, async ({ access, params: p }) => {
  await deleteAlertRule(access, p.id);
  return { ok: true };
});
