import { orgRoute } from "@/server/http/route";
import { getMembers } from "@/server/services/organization-service";

export const GET = orgRoute({ operation: "members.list", permission: "members:read" }, async ({ access }) => ({
  members: await getMembers(access),
}));
