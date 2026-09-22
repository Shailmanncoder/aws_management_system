import { orgRoute } from "@/server/http/route";
import { inviteInput, inviteMember, listPendingInvitations } from "@/server/services/organization-service";

export const GET = orgRoute({ operation: "invitations.list", permission: "members:invite" }, async ({ access }) => ({
  invitations: await listPendingInvitations(access),
}));

export const POST = orgRoute(
  { operation: "invitations.create", permission: "members:invite", body: inviteInput, rateLimit: "invite", rateLimitBy: "org" },
  async ({ access, body }) => {
    const { invitation, token } = await inviteMember(access, body);
    // The raw token is returned exactly once so the inviter can share the link.
    return { invitation, invitePath: `/invite/${token}` };
  },
);
