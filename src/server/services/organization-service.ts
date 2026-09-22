import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { canAssignRole, hasPermission, ROLES, type Role } from "@/lib/rbac";
import type { OrgRole } from "@/generated/prisma/client";
import { getDb } from "../db";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { assertCan, type OrgAccess } from "../authz/guard";
import { randomToken, sha256Hex } from "../security/crypto";
import { emailSchema, orgNameSchema } from "../validation/common";
import {
  countOwners,
  deleteMember,
  listMembers,
  updateMemberRole,
} from "../repositories/member-repository";
import { AUDIT, recordAudit } from "./audit-service";

export const createOrgInput = z.strictObject({ name: orgNameSchema });
export const inviteInput = z.strictObject({ email: emailSchema, role: z.enum(ROLES) });
export const changeRoleInput = z.strictObject({ role: z.enum(ROLES) });

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const padded = base.length >= 3 ? base : `ws-${base || "x"}`;
  // Random suffix: slugs are not guessable and never collide in practice.
  return `${padded.replace(/-+$/, "")}-${randomBytes(3).toString("hex")}`;
}

/** Creates an organization with the caller as OWNER (single transaction). */
export async function createOrganization(userId: string, input: z.infer<typeof createOrgInput>) {
  const org = await getDb().$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { name: input.name, slug: slugify(input.name) },
      select: { id: true, name: true, slug: true },
    });
    await tx.organizationMember.create({ data: { organizationId: created.id, userId, role: "OWNER" } });
    return created;
  });
  await recordAudit({
    action: AUDIT.ORG_CREATED,
    organizationId: org.id,
    actorUserId: userId,
    outcome: "SUCCESS",
    targetType: "organization",
    targetId: org.id,
  });
  return org;
}

export async function getOrganization(access: OrgAccess) {
  const org = await getDb().organization.findUnique({
    where: { id: access.organizationId },
    select: { id: true, name: true, slug: true, actionModeEnabled: true, createdAt: true },
  });
  if (!org) throw notFound("Workspace");
  return org;
}

export async function renameOrganization(access: OrgAccess, name: string) {
  assertCan(access, "org:update");
  const parsed = orgNameSchema.parse(name);
  await getDb().organization.update({ where: { id: access.organizationId }, data: { name: parsed } });
  await recordAudit({
    action: AUDIT.ORG_UPDATED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "organization",
    targetId: access.organizationId,
    metadata: { field: "name" },
  });
}

export async function getMembers(access: OrgAccess) {
  assertCan(access, "members:read");
  return listMembers(access.organizationId);
}

/**
 * Creates an invitation and returns the one-time token (shown once to the inviter; only its hash
 * is stored). Email delivery is pluggable; until configured the inviter shares the link.
 */
export async function inviteMember(access: OrgAccess, input: z.infer<typeof inviteInput>) {
  assertCan(access, "members:invite");
  if (!canAssignRole(access.role, input.role)) throw forbidden("You cannot invite a member with that role.");

  const db = getDb();
  const existingMember = await db.organizationMember.findFirst({
    where: { organizationId: access.organizationId, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) throw conflict("That user is already a member of this workspace.");

  const token = randomToken(32);
  const invitation = await db.invitation.create({
    data: {
      organizationId: access.organizationId,
      email: input.email,
      role: input.role,
      tokenHash: sha256Hex(token),
      invitedById: access.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  await recordAudit({
    action: AUDIT.MEMBER_INVITED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { role: input.role },
  });
  return { invitation, token };
}

export async function listPendingInvitations(access: OrgAccess) {
  assertCan(access, "members:invite");
  return getDb().invitation.findMany({
    where: { organizationId: access.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeInvitation(access: OrgAccess, invitationId: string) {
  assertCan(access, "members:invite");
  const res = await getDb().invitation.updateMany({
    where: { id: invitationId, organizationId: access.organizationId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw notFound("Invitation");
  await recordAudit({
    action: AUDIT.INVITE_REVOKED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "invitation",
    targetId: invitationId,
  });
}

/**
 * Accepts an invitation. The token must match, be unexpired/unused, and the signed-in user's
 * email must equal the invited email (prevents link forwarding to a different account).
 */
export async function acceptInvitation(user: { id: string; email: string }, token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw notFound("Invitation");
  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw notFound("Invitation");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError("FORBIDDEN", "This invitation was issued to a different email address.");
    }
    // Single-use: conditional update wins exactly once under concurrency.
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw notFound("Invitation");
    await tx.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
      update: {},
      create: { organizationId: inv.organizationId, userId: user.id, role: inv.role },
    });
    return inv;
  });
  await recordAudit({
    action: AUDIT.MEMBER_JOINED,
    organizationId: result.organizationId,
    actorUserId: user.id,
    outcome: "SUCCESS",
    targetType: "invitation",
    targetId: result.id,
    metadata: { role: result.role },
  });
  return { organizationId: result.organizationId };
}

export async function changeMemberRole(access: OrgAccess, memberId: string, role: Role) {
  assertCan(access, "members:manage");
  const target = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${access.organizationId}::uuid FOR UPDATE`;
    const actor = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: access.organizationId, userId: access.userId } } });
    const target = await tx.organizationMember.findFirst({ where: { organizationId: access.organizationId, id: memberId } });
    if (!actor || !hasPermission(actor.role as Role, "members:manage")) throw forbidden();
    if (!target) throw notFound("Member");
    if (target.userId === access.userId) throw forbidden("You cannot change your own role.");
    if (!canAssignRole(actor.role as Role, role, target.role as Role)) throw forbidden("You cannot assign that role.");
    await updateMemberRole(access.organizationId, memberId, role as OrgRole, tx);
    if ((await countOwners(access.organizationId, tx)) < 1) throw new AppError("PRECONDITION_FAILED", "A workspace must keep at least one owner.");
    return target;
  });
  await recordAudit({
    action: AUDIT.MEMBER_ROLE_CHANGED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "member",
    targetId: memberId,
    metadata: { from: target.role, to: role },
  });
}

export async function removeMember(access: OrgAccess, memberId: string) {
  assertCan(access, "members:manage");
  const target = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${access.organizationId}::uuid FOR UPDATE`;
    const actor = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: access.organizationId, userId: access.userId } } });
    const target = await tx.organizationMember.findFirst({ where: { organizationId: access.organizationId, id: memberId } });
    if (!actor || !hasPermission(actor.role as Role, "members:manage")) throw forbidden();
    if (!target) throw notFound("Member");
    if (target.userId === access.userId) throw forbidden("You cannot remove yourself.");
    if (!canAssignRole(actor.role as Role, target.role as Role, target.role as Role)) throw forbidden("You cannot remove a member with that role.");
    await deleteMember(access.organizationId, memberId, tx);
    if ((await countOwners(access.organizationId, tx)) < 1) throw new AppError("PRECONDITION_FAILED", "A workspace must keep at least one owner.");
    return target;
  });
  // Revoke the removed user's sessions? Sessions are account-wide, not per org; membership is
  // re-checked on every request, so access to this org ends immediately.
  await recordAudit({
    action: AUDIT.MEMBER_REMOVED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "member",
    targetId: memberId,
    metadata: { role: target.role },
  });
}
