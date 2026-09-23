import { orgRoute } from "@/server/http/route";
import { helpInput, getHelp, createHelp } from "@/server/services/simple-service";
export const GET = orgRoute({ operation: "help.list", permission: "org:read" }, async ({ access }) => ({ requests: await getHelp(access) }));
export const POST = orgRoute({ operation: "help.create", permission: "members:read", body: helpInput, rateLimit: "api" }, async ({ access, body }) => createHelp(access, body));
