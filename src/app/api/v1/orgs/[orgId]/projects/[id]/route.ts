import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { projectInput, saveProject, deleteProject } from "@/server/services/simple-service";
const params = z.object({ id: z.uuid() });
export const PATCH = orgRoute({ operation: "projects.update", permission: "org:update", params, body: projectInput, rateLimit: "api" }, async ({ access, params, body }) => saveProject(access, body, params.id));
export const DELETE = orgRoute({ operation: "projects.delete", permission: "org:update", params, rateLimit: "api" }, async ({ access, params }) => deleteProject(access, params.id));
