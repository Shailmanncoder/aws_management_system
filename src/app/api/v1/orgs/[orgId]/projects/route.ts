import { orgRoute } from "@/server/http/route";
import { projectInput, getProjects, saveProject } from "@/server/services/simple-service";
export const GET = orgRoute({ operation: "projects.list", permission: "org:read" }, async ({ access }) => getProjects(access));
export const POST = orgRoute({ operation: "projects.create", permission: "org:update", body: projectInput, rateLimit: "api" }, async ({ access, body }) => saveProject(access, body));
