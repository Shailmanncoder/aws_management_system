import type { Metadata } from "next";
import { NoAccess } from "@/components/common/states";
import { MembersManager } from "@/components/settings/members-manager";
import { getMembers, listPendingInvitations } from "@/server/services/organization-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { ctx, access } = await getPageAccess("members:read");
  if (!access) return <NoAccess what="workspace members" />;
  const members = await getMembers(access);
  const invitations = access.can("members:invite") ? await listPendingInvitations(access) : [];
  return (
    <MembersManager
      orgId={access.organizationId}
      currentUserId={ctx.user.id}
      actorRole={access.role}
      members={members.map((m) => ({
        id: m.id,
        role: m.role,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        mfa: Boolean(m.user.twoFactorEnabled),
        joinedAt: m.createdAt.toISOString(),
      }))}
      invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
    />
  );
}
