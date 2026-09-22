import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { notFound } from "../errors";
import { regionSchema, searchTermSchema, uuidSchema } from "../validation/common";
import { AUDIT, recordAudit } from "./audit-service";

export const OPT_CATEGORIES = ["idle", "storage", "rightsizing", "network", "governance"] as const;
export const DATA_BASES = ["CONFIRMED", "HEURISTIC", "ESTIMATED"] as const;
export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;

const params = z.object({
  q: searchTermSchema.optional().catch(undefined),
  category: z.enum(OPT_CATEGORIES).optional().catch(undefined),
  basis: z.enum(DATA_BASES).optional().catch(undefined),
  confidence: z.enum(CONFIDENCES).optional().catch(undefined),
  status: z.enum(["OPEN", "RESOLVED", "SUPPRESSED"]).optional().catch(undefined),
  account: uuidSchema.optional().catch(undefined),
  region: regionSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export function parseOptimizationParams(raw: Record<string, string | string[] | undefined>) {
  return params.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
}

function where(access: OrgAccess, p: z.infer<typeof params>): Prisma.OptimizationFindingWhereInput {
  return {
    organizationId: access.organizationId,
    status: p.status ?? "OPEN",
    ...(p.category ? { category: p.category } : {}),
    ...(p.basis ? { dataBasis: p.basis } : {}),
    ...(p.confidence ? { confidence: p.confidence } : {}),
    ...(p.account ? { awsAccountRefId: p.account } : {}),
    ...(p.region ? { region: p.region } : {}),
    ...(p.q ? { OR: [{ title: { contains: p.q, mode: "insensitive" } }, { ruleId: { contains: p.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listOptimizationFindings(access: OrgAccess, raw: Record<string, string | string[] | undefined>) {
  assertCan(access, "optimization:read");
  const p = parseOptimizationParams(raw);
  const w = where(access, p);
  const pageSize = 25;
  const [items, total, savings, byCategory] = await Promise.all([
    getDb().optimizationFinding.findMany({
      where: w,
      orderBy: [{ estimatedMonthlySavings: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }],
      skip: (p.page - 1) * pageSize,
      take: pageSize,
      include: { awsAccount: { select: { displayName: true } }, resource: { select: { id: true, resourceType: true, resourceId: true, name: true } } },
    }),
    getDb().optimizationFinding.count({ where: w }),
    getDb().optimizationFinding.aggregate({ where: { ...w, estimatedMonthlySavings: { not: null } }, _sum: { estimatedMonthlySavings: true }, _count: { _all: true } }),
    getDb().optimizationFinding.groupBy({ by: ["category"], where: { organizationId: access.organizationId, status: "OPEN" }, _count: { _all: true } }),
  ]);
  return {
    items,
    total,
    page: p.page,
    pageSize,
    estimatedSavings: savings._sum.estimatedMonthlySavings ? Number(savings._sum.estimatedMonthlySavings.toString()) : 0,
    withEstimate: savings._count._all,
    byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])) as Record<string, number>,
  };
}

export async function getOptimizationFinding(access: OrgAccess, id: string) {
  assertCan(access, "optimization:read");
  return getDb().optimizationFinding.findFirst({
    where: { id, organizationId: access.organizationId },
    include: { awsAccount: { select: { displayName: true, awsAccountId: true } }, resource: { select: { id: true, resourceType: true, resourceId: true, name: true } } },
  });
}

export const optimizationStateInput = z.strictObject({ status: z.enum(["OPEN", "SUPPRESSED"]), reason: z.string().trim().min(5).max(500) });

/** Dismiss (SUPPRESSED) or reopen a recommendation. Dismissals survive later analyses. */
export async function setOptimizationState(access: OrgAccess, id: string, input: z.infer<typeof optimizationStateInput>) {
  assertCan(access, "optimization:manage");
  const res = await getDb().optimizationFinding.updateMany({
    where: { id, organizationId: access.organizationId, status: { in: ["OPEN", "SUPPRESSED"] } },
    data: { status: input.status, resolvedAt: null },
  });
  if (res.count === 0) throw notFound("Recommendation");
  await recordAudit({
    action: AUDIT.FINDING_SUPPRESSED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "optimization_finding",
    targetId: id,
    metadata: { status: input.status, reason: input.reason },
  });
}

export async function setRequiredTagKeys(access: OrgAccess, keys: string[]) {
  assertCan(access, "org:update");
  const clean = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].slice(0, 20);
  await getDb().organization.update({ where: { id: access.organizationId }, data: { requiredTagKeys: clean } });
  return clean;
}
