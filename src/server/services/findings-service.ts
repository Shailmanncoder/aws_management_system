import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { assertCan } from "../authz/guard";
import { notFound } from "../errors";
import { uuidSchema, regionSchema } from "../validation/common";
import { AUDIT, recordAudit } from "./audit-service";
import type { OrgAccess } from "../authz/guard";
import { getDb } from "../db";

/** Findings linked to a resource, filtered by what the viewer is permitted to see. */
export async function findingsForResource(access: OrgAccess, resourceRefId: string) {
  const db = getDb();
  const [security, optimization] = await Promise.all([
    access.can("security:read")
      ? db.securityFinding.findMany({
          where: { organizationId: access.organizationId, resourceRefId, status: "OPEN" },
          select: { id: true, title: true, severity: true },
          orderBy: { severity: "asc" },
          take: 50,
        })
      : [],
    access.can("optimization:read")
      ? db.optimizationFinding.findMany({
          where: { organizationId: access.organizationId, resourceRefId, status: "OPEN" },
          select: { id: true, title: true },
          take: 50,
        })
      : [],
  ]);
  return { security, optimization, visible: access.can("security:read") || access.can("optimization:read") };
}

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as const;
export const FINDING_STATUSES = ["OPEN", "RESOLVED", "SUPPRESSED"] as const;
export const FINDING_SOURCES = ["STRATUS_RULE", "GUARDDUTY", "SECURITY_HUB"] as const;

const filters = z.object({
  q: z.string().max(128).optional().catch(undefined),
  account: uuidSchema.optional().catch(undefined),
  region: regionSchema.optional().catch(undefined),
  severity: z.enum(SEVERITIES).optional().catch(undefined),
  status: z.enum(FINDING_STATUSES).catch("OPEN").default("OPEN"),
  source: z.enum(FINDING_SOURCES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
});
export function parseFindingParams(raw: Record<string, string | string[] | undefined>) {
  return filters.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
}
export async function listSecurityFindings(access: OrgAccess, raw: Record<string, string | string[] | undefined>) {
  assertCan(access, "security:read");
  const p = parseFindingParams(raw);
  const where: Prisma.SecurityFindingWhereInput = {
    organizationId: access.organizationId, status: p.status,
    ...(p.account ? { awsAccountRefId: p.account } : {}),
    ...(p.region ? { region: p.region } : {}),
    ...(p.severity ? { severity: p.severity } : {}),
    ...(p.source ? { source: p.source } : {}),
    ...(p.q ? { OR: [{ title: { contains: p.q, mode: "insensitive" } }, { ruleId: { contains: p.q, mode: "insensitive" } }] } : {}),
  };
  const db = getDb();
  const [items, total, accounts] = await Promise.all([
    db.securityFinding.findMany({ where, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }, { id: "asc" }], skip: (p.page - 1) * 25, take: 25,
      include: { awsAccount: { select: { displayName: true, awsAccountId: true } } } }),
    db.securityFinding.count({ where }),
    db.awsAccount.findMany({ where: { organizationId: access.organizationId, ...(p.account ? { id: p.account } : {}) },
      select: { id: true, displayName: true, securityScannedAt: true, securityCoverage: true } }),
  ]);
  return { items, total, accounts, page: p.page, pageSize: 25 };
}

export const findingStateInput = z.object({ status: z.enum(["OPEN", "SUPPRESSED"]), reason: z.string().trim().min(5).max(500) }).strict();
export async function setFindingState(access: OrgAccess, id: string, input: z.infer<typeof findingStateInput>) {
  assertCan(access, "security:manage");
  const data = findingStateInput.parse(input);
  const result = await getDb().securityFinding.updateMany({
    where: { organizationId: access.organizationId, id: uuidSchema.parse(id), status: { in: ["OPEN", "SUPPRESSED"] } },
    data: { status: data.status, resolvedAt: null },
  });
  if (!result.count) throw notFound("Active finding");
  await recordAudit({ action: data.status === "SUPPRESSED" ? AUDIT.FINDING_SUPPRESSED : AUDIT.FINDING_REOPENED,
    organizationId: access.organizationId, actorUserId: access.userId, targetType: "security_finding", targetId: id,
    outcome: "SUCCESS", metadata: { reason: data.reason } });
}

/** Tenant-scoped single security finding (cross-tenant ids → null). */
export async function getSecurityFinding(access: OrgAccess, id: string) {
  assertCan(access, "security:read");
  return getDb().securityFinding.findFirst({
    where: { id, organizationId: access.organizationId },
    include: { awsAccount: { select: { displayName: true, awsAccountId: true } }, resource: { select: { id: true, resourceType: true, resourceId: true, name: true } } },
  });
}
