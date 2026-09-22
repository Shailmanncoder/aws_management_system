import "server-only";
import { z } from "zod";
import { assertCan, type OrgAccess } from "../authz/guard";
import { listAudit } from "../repositories/audit-repository";
import { uuidSchema } from "../validation/common";

const params = z.object({
  action: z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/).max(60).optional().catch(undefined),
  outcome: z.enum(["SUCCESS", "FAILURE"]).optional().catch(undefined),
  cursor: uuidSchema.optional().catch(undefined),
});

/** Read-only audit trail for the workspace (append-only at the database level). */
export async function getAuditLog(access: OrgAccess, raw: Record<string, string | string[] | undefined>, limit = 50) {
  assertCan(access, "audit:read");
  const p = params.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  return listAudit(access.organizationId, { ...p, limit });
}
