/**
 * RBAC matrix — the single source of truth for role → permission mapping.
 *
 * This file is client-safe (pure data) so the UI can hide controls a user cannot use, but hiding
 * is cosmetic only: every server entry point re-checks via `requireOrgPermission`.
 */

export const ROLES = [
  "OWNER",
  "ADMIN",
  "OPERATOR",
  "PROVISIONER",
  "VIEWER",
  "BILLING_VIEWER",
  "SECURITY_VIEWER",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:read",
  "org:update",
  "org:delete",
  "members:read",
  "members:invite",
  "members:manage",
  "aws_accounts:read",
  "aws_accounts:connect",
  "aws_accounts:disconnect",
  "sync:trigger",
  "inventory:read",
  "metrics:read",
  "cost:read",
  "security:read",
  "security:manage",
  "optimization:read",
  "optimization:manage",
  "alerts:read",
  "alerts:acknowledge",
  "alerts:manage",
  "audit:read",
  "reports:export",
  "actions:request",
  "actions:configure",
  "provisioning:create",
  "provisioning:configure",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;

const READ_BASE: Permission[] = [
  "org:read",
  "members:read",
  "aws_accounts:read",
  "alerts:read",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(ALL),
  ADMIN: new Set(
    ALL.filter((p) => p !== "org:delete" && p !== "actions:configure"),
  ),
  OPERATOR: new Set<Permission>([
    ...READ_BASE,
    "sync:trigger",
    "inventory:read",
    "metrics:read",
    "cost:read",
    "security:read",
    "optimization:read",
    "optimization:manage",
    "alerts:acknowledge",
    "reports:export",
    "actions:request",
  ]),
  PROVISIONER: new Set<Permission>([
    ...READ_BASE,
    "inventory:read",
    "metrics:read",
    "cost:read",
    "sync:trigger",
    "provisioning:create",
  ]),
  VIEWER: new Set<Permission>([
    ...READ_BASE,
    "inventory:read",
    "metrics:read",
    "cost:read",
    "optimization:read",
  ]),
  BILLING_VIEWER: new Set<Permission>([
    ...READ_BASE,
    "cost:read",
    "optimization:read",
    "reports:export",
  ]),
  SECURITY_VIEWER: new Set<Permission>([
    ...READ_BASE,
    "inventory:read",
    "metrics:read",
    "security:read",
    "audit:read",
    "reports:export",
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  OPERATOR: "Operator",
  PROVISIONER: "Provisioner",
  VIEWER: "Viewer",
  BILLING_VIEWER: "Billing Viewer",
  SECURITY_VIEWER: "Security Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER:
    "Full control including workspace deletion and enabling operational actions.",
  ADMIN: "Manage members, AWS connections, alerts and settings.",
  OPERATOR:
    "Trigger syncs, view all data, acknowledge alerts, request operational actions.",
  PROVISIONER:
    "Create approved EC2 instances and private S3 buckets after review.",
  VIEWER: "Read-only access to inventory, cost and optimisation data.",
  BILLING_VIEWER: "Cost and optimisation data only.",
  SECURITY_VIEWER: "Inventory, security findings and audit logs.",
};

const RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  OPERATOR: 60,
  PROVISIONER: 65,
  VIEWER: 40,
  BILLING_VIEWER: 40,
  SECURITY_VIEWER: 40,
};

/**
 * Whether `actor` may assign `target` role (or modify a member currently holding `current`).
 * Only owners may create/modify owners and admins; admins may manage lower roles.
 */
export function canAssignRole(
  actor: Role,
  target: Role,
  current?: Role,
): boolean {
  if (
    !hasPermission(actor, "members:manage") &&
    !hasPermission(actor, "members:invite")
  )
    return false;
  if (actor === "OWNER") return true;
  const ceiling = RANK[actor];
  if (RANK[target] >= ceiling) return false;
  if (current !== undefined && RANK[current] >= ceiling) return false;
  return true;
}
