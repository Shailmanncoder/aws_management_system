import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { recordInput } from "@/lib/operations";
import { saveRecord, deleteRecord, templatePlan } from "@/server/services/operations-service";
import { transitionOperation } from "@/server/services/operation-plan-service";
import { testNotification } from "@/server/services/notification-service";
const params = z.strictObject({ id: z.uuid() });
export const PATCH = orgRoute({ operation: "operations.update", permission: "org:read", params, body: z.strictObject({ input: recordInput, version: z.number().int().positive() }), rateLimit: "api" }, ({ access, params, body }) => saveRecord(access, body.input, params.id, body.version));
export const DELETE = orgRoute({ operation: "operations.delete", permission: "org:read", params, rateLimit: "api" }, ({ access, params }) => deleteRecord(access, params.id));
export const POST = orgRoute({ operation: "operations.action", permission: "org:read", params, body: z.strictObject({ action: z.enum(["approve", "reject", "cancel", "execute", "test", "template-plan"]), name: z.string().trim().min(1).max(63).optional() }), rateLimit: "api" }, ({ access, params, body }) => {
  if (body.action === "test") return testNotification(access, params.id);
  if (body.action === "template-plan") return templatePlan(access, params.id, body.name);
  return transitionOperation(access, params.id, body.action);
});
