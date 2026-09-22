import "server-only";
import { RESOURCE_TYPES } from "@/lib/resource-types";
import { assertCan, type OrgAccess } from "../authz/guard";
import { cached } from "../cache/tenant-cache";
import { getDb } from "../db";
import { listAccounts } from "../repositories/aws-account-repository";
import { countByType } from "../repositories/resource-repository";

export interface Scope {
  account?: string;
  region?: string;
}

const filterFor = (s: Scope) => ({ accountRefIds: s.account ? [s.account] : undefined, regions: s.region ? [s.region] : undefined });

export async function getInventorySummary(access: OrgAccess, scope: Scope) {
  assertCan(access, "inventory:read");
  return cached(access.organizationId, "dash-inventory", [scope.account, scope.region], 60_000, async () => {
    const db = getDb();
    const f = filterFor(scope);
    const where = {
      organizationId: access.organizationId,
      deletedAt: null,
      ...(f.accountRefIds ? { awsAccountRefId: { in: f.accountRefIds } } : {}),
      ...(f.regions ? { region: { in: f.regions } } : {}),
    };
    const [byType, regions, ec2States, accounts] = await Promise.all([
      countByType(access.organizationId, f),
      db.awsResource.groupBy({ by: ["region"], where: { ...where, region: { not: "global", ...(f.regions ? { in: f.regions } : {}) } } }),
      db.awsResource.groupBy({ by: ["state"], where: { ...where, resourceType: RESOURCE_TYPES.EC2_INSTANCE }, _count: { _all: true } }),
      listAccounts(access.organizationId),
    ]);
    const c = (...types: string[]) => types.reduce((s, t) => s + (byType[t] ?? 0), 0);
    return {
      accounts: accounts.length,
      connectedAccounts: accounts.filter((a) => a.connection && ["CONNECTED", "NEEDS_ATTENTION", "PERMISSION_PROBLEM"].includes(a.connection.status)).length,
      resources: Object.values(byType).reduce((a, b) => a + b, 0),
      regions: regions.length,
      ec2: c(RESOURCE_TYPES.EC2_INSTANCE),
      s3: c(RESOURCE_TYPES.S3_BUCKET),
      databases: c(RESOURCE_TYPES.RDS_INSTANCE, RESOURCE_TYPES.RDS_CLUSTER, RESOURCE_TYPES.DYNAMODB_TABLE),
      lambda: c(RESOURCE_TYPES.LAMBDA_FUNCTION),
      containers: c(RESOURCE_TYPES.ECS_CLUSTER, RESOURCE_TYPES.EKS_CLUSTER, RESOURCE_TYPES.ECR_REPOSITORY),
      byType,
      ec2States: ec2States.map((s) => ({ state: s.state ?? "unknown", count: s._count._all })).sort((a, b) => b.count - a.count),
      syncIssues: accounts.filter((a) => a.syncStatus === "FAILED" || a.syncStatus === "PARTIAL").map((a) => ({ id: a.id, name: a.displayName, status: a.syncStatus, error: a.syncError })),
      neverSynced: accounts.filter((a) => a.syncStatus === "NEVER" || a.syncStatus === "QUEUED" || a.syncStatus === "RUNNING").length,
    };
  });
}

export async function getSecuritySummary(access: OrgAccess, scope: Scope) {
  assertCan(access, "security:read");
  const rows = await getDb().securityFinding.groupBy({
    by: ["severity"],
    where: { organizationId: access.organizationId, status: "OPEN", ...(scope.account ? { awsAccountRefId: scope.account } : {}), ...(scope.region ? { region: scope.region } : {}) },
    _count: { _all: true },
  });
  const bySeverity = Object.fromEntries(rows.map((r) => [r.severity, r._count._all])) as Record<string, number>;
  const accounts = await getDb().awsAccount.findMany({ where: { organizationId: access.organizationId, ...(scope.account ? { id: scope.account } : {}) }, select: { securityScannedAt: true, securityCoverage: true } });
  const incomplete = accounts.filter((a) => !a.securityScannedAt || Date.now() - a.securityScannedAt.getTime() > 24 * 60 * 60_000 || ((a.securityCoverage as { gaps?: string[] } | null)?.gaps?.length ?? 0) > 0).length;
  return { bySeverity, total: rows.reduce((s, r) => s + r._count._all, 0), coverageMessage: accounts.length === 0 ? "No accounts assessed" : incomplete ? `${incomplete} account(s) have missing, stale or incomplete scans` : "Configured checks completed; not a security guarantee" };
}

export async function getOptimizationSummary(access: OrgAccess, scope: Scope) {
  assertCan(access, "optimization:read");
  const where = { organizationId: access.organizationId, status: "OPEN" as const, ...(scope.account ? { awsAccountRefId: scope.account } : {}), ...(scope.region ? { region: scope.region } : {}) };
  const [count, savings, byBasis] = await Promise.all([
    getDb().optimizationFinding.count({ where }),
    getDb().optimizationFinding.aggregate({ where: { ...where, estimatedMonthlySavings: { not: null } }, _sum: { estimatedMonthlySavings: true }, _count: { _all: true } }),
    getDb().optimizationFinding.groupBy({ by: ["dataBasis"], where, _count: { _all: true } }),
  ]);
  return {
    total: count,
    estimatedMonthlySavings: savings._sum.estimatedMonthlySavings ? Number(savings._sum.estimatedMonthlySavings.toString()) : 0,
    withSavingsEstimate: savings._count._all,
    byBasis: Object.fromEntries(byBasis.map((b) => [b.dataBasis, b._count._all])) as Record<string, number>,
  };
}
