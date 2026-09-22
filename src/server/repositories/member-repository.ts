import "server-only";
import type { OrgRole } from "@/generated/prisma/client";
import { getDb, type Tx } from "../db";

export async function findMembership(organizationId: string, userId: string) {
  return getDb().organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, role: true, organizationId: true, userId: true },
  });
}

export async function listMembershipsForUser(userId: string) {
  return getDb().organizationMember.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listMembers(organizationId: string) {
  return getDb().organizationMember.findMany({
    where: { organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, twoFactorEnabled: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Tenant-scoped lookup of a member row. Returns null for rows in other orgs. */
export async function findMemberById(organizationId: string, memberId: string) {
  return getDb().organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true, userId: true },
  });
}

export async function countOwners(organizationId: string, tx?: Tx) {
  return (tx ?? getDb()).organizationMember.count({ where: { organizationId, role: "OWNER" } });
}

export async function updateMemberRole(organizationId: string, memberId: string, role: OrgRole, tx?: Tx) {
  // updateMany with the org filter guarantees we can never touch another tenant's row.
  return (tx ?? getDb()).organizationMember.updateMany({ where: { id: memberId, organizationId }, data: { role } });
}

export async function deleteMember(organizationId: string, memberId: string, tx?: Tx) {
  return (tx ?? getDb()).organizationMember.deleteMany({ where: { id: memberId, organizationId } });
}
