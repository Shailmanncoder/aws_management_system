import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission, Role } from "@/lib/rbac";
import { getCurrentUser, type SessionUser } from "../auth/session";
import { authorizeOrg, type OrgAccess } from "../authz/guard";
import { isAppError } from "../errors";
import { listMembershipsForUser } from "../repositories/member-repository";

export const ACTIVE_ORG_COOKIE = "stratus_active_org";

export interface WorkspaceContext {
  user: SessionUser;
  org: { id: string; name: string; slug: string };
  role: Role;
  memberships: { id: string; name: string; slug: string; role: Role }[];
}

/**
 * Resolves the signed-in user's active workspace for server components. The cookie only
 * *selects* among the user's memberships — it grants nothing: a value naming a foreign org is
 * ignored because it never matches a membership row.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const rows = await listMembershipsForUser(user.id);
  if (rows.length === 0) redirect("/onboarding");
  const memberships = rows.map((r) => ({ ...r.organization, role: r.role as Role }));
  const selected = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.id === selected) ?? memberships[0]!;
  return { user, org: { id: active.id, name: active.name, slug: active.slug }, role: active.role, memberships };
});

/**
 * Page-level authorization: resolves the workspace and asserts `permission` via the same
 * central guard used by API routes. Returns null (render a "no access" state) when forbidden.
 */
export async function getPageAccess(permission: Permission): Promise<{ ctx: WorkspaceContext; access: OrgAccess | null }> {
  const ctx = await getWorkspaceContext();
  try {
    const access = await authorizeOrg(ctx.user.id, ctx.org.id, permission);
    return { ctx, access };
  } catch (e) {
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) return { ctx, access: null };
    throw e;
  }
}
