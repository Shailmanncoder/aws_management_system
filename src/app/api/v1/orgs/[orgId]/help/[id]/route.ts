import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { completeHelp } from "@/server/services/simple-service";
export const PATCH = orgRoute({ operation: "help.update", permission: "org:read", params: z.object({ id: z.uuid() }), body: z.strictObject({ status: z.enum(["OPEN", "DONE"]) }), rateLimit: "api" }, async ({ access, params, body }) => completeHelp(access, params.id, body.status));
