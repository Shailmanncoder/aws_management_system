import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { changeMemberRole, changeRoleInput, removeMember } from "@/server/services/organization-service";
import { uuidSchema } from "@/server/validation/common";

const params = z.strictObject({ memberId: uuidSchema });

export const PATCH = orgRoute(
  { operation: "members.change_role", permission: "members:manage", params, body: changeRoleInput, rateLimit: "api" },
  async ({ access, params: p, body }) => {
    await changeMemberRole(access, p.memberId, body.role);
    return { ok: true };
  },
);

export const DELETE = orgRoute(
  { operation: "members.remove", permission: "members:manage", params, rateLimit: "api" },
  async ({ access, params: p }) => {
    await removeMember(access, p.memberId);
    return { ok: true };
  },
);
