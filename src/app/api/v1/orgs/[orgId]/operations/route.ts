import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { recordInput, operationInput } from "@/lib/operations";
import { getOperations, saveRecord } from "@/server/services/operations-service";
import { createOperation, actionRoleInput, configureActionRole } from "@/server/services/operation-plan-service";
export const GET = orgRoute({ operation: "operations.read", permission: "org:read" }, ({ access }) => getOperations(access));
const body = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("save"), input: recordInput }),
  z.strictObject({ command: z.literal("plan"), input: operationInput }),
  z.strictObject({ command: z.literal("configure"), input: actionRoleInput }),
]);
export const POST = orgRoute({ operation: "operations.create", permission: "org:read", body, rateLimit: "api" }, async ({ access, body }) => {
  if (body.command === "save") return saveRecord(access, body.input);
  if (body.command === "plan") return createOperation(access, body.input);
  return configureActionRole(access, body.input);
});
