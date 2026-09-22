import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { revokeInvitation } from "@/server/services/organization-service";
import { uuidSchema } from "@/server/validation/common";

export const DELETE = orgRoute(
  { operation: "invitations.revoke", permission: "members:invite", params: z.strictObject({ invitationId: uuidSchema }) },
  async ({ access, params }) => {
    await revokeInvitation(access, params.invitationId);
    return { ok: true };
  },
);
