import "server-only";
import { hasPermission, type Permission, type Role } from "@/lib/rbac";
import { forbidden, notFound } from "../errors";
import { enrichContext } from "../logging/context";
import { logger } from "../logging/logger";
import { findMembership } from "../repositories/member-repository";
import { isUuid } from "../validation/common";

/**
 * Centralised authorization. Every org-scoped server entry point MUST obtain an `OrgAccess`
 * through `authorizeOrg` before touching tenant data, and every repository call receives
 * `access.organizationId` — never an organization id taken straight from user input.
 */
export interface OrgAccess {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Role;
  can(permission: Permission): boolean;
}

export async function authorizeOrg(userId: string, organizationId: unknown, permission: Permission): Promise<OrgAccess> {
  // Malformed ids are treated exactly like non-existent / foreign orgs (no oracle).
  if (!isUuid(organizationId)) throw notFound("Workspace");

  const membership = await findMembership(organizationId, userId);
  if (!membership) {
    logger.warn("authz: non-member access attempt", { targetOrganizationId: organizationId, permission });
    throw notFound("Workspace");
  }
  const role = membership.role as Role;
  if (!hasPermission(role, permission)) {
    logger.warn("authz: permission denied", { organizationId, role, permission });
    throw forbidden();
  }
  enrichContext({ organizationId, userId });
  return Object.freeze({
    organizationId,
    userId,
    role,
    can: (p: Permission) => hasPermission(role, p),
  });
}

/** Asserts an additional permission on an already-authorized access object. */
export function assertCan(access: OrgAccess, permission: Permission): void {
  if (!access.can(permission)) throw forbidden();
}
