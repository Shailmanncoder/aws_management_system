import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "../db";

export interface ResourceQuery {
  types: string[];
  accountRefIds?: string[];
  regions?: string[];
  states?: string[];
  search?: string;
  tag?: { key: string; value?: string };
  /** Exact-match filters on normalised attributes (validated keys only — see service). */
  attributeEquals?: Record<string, string>;
  includeDeleted?: boolean;
  unownedIds?: string[];
  sort?: { field: "name" | "resourceId" | "region" | "state" | "lastSeenAt" | "firstSeenAt"; dir: "asc" | "desc" };
  page: number;
  pageSize: number;
}

export const RESOURCE_LIST_SELECT = {
  id: true,
  resourceType: true,
  region: true,
  resourceId: true,
  arn: true,
  name: true,
  state: true,
  attributes: true,
  firstSeenAt: true,
  lastSeenAt: true,
  deletedAt: true,
  awsAccount: { select: { id: true, awsAccountId: true, displayName: true } },
  tags: { select: { key: true, value: true }, orderBy: { key: "asc" as const }, take: 20 },
} satisfies Prisma.AwsResourceSelect;

export type ResourceRow = Prisma.AwsResourceGetPayload<{ select: typeof RESOURCE_LIST_SELECT }>;

function where(organizationId: string, q: Omit<ResourceQuery, "page" | "pageSize" | "sort">): Prisma.AwsResourceWhereInput {
  const and: Prisma.AwsResourceWhereInput[] = [];
  if (q.search) {
    const term = q.search.toLowerCase();
    and.push({ searchText: { contains: term } });
  }
  if (q.tag) {
    and.push({ tags: { some: { organizationId, key: q.tag.key, ...(q.tag.value !== undefined ? { value: q.tag.value } : {}) } } });
  }
  for (const [key, value] of Object.entries(q.attributeEquals ?? {})) {
    and.push({ attributes: { path: [key], equals: value } });
  }
  return {
    organizationId,
    ...(q.unownedIds ? { id: { notIn: q.unownedIds } } : {}),
    resourceType: { in: q.types },
    ...(q.accountRefIds?.length ? { awsAccountRefId: { in: q.accountRefIds } } : {}),
    ...(q.regions?.length ? { region: { in: q.regions } } : {}),
    ...(q.states?.length ? { state: { in: q.states } } : {}),
    ...(q.includeDeleted ? {} : { deletedAt: null }),
    ...(and.length ? { AND: and } : {}),
  };
}

/** Tenant-scoped, server-paginated listing (single query + count; relations are batched). */
export async function listResources(organizationId: string, q: ResourceQuery): Promise<{ items: ResourceRow[]; total: number }> {
  const db = getDb();
  const w = where(organizationId, q);
  const sort = q.sort ?? { field: "name", dir: "asc" };
  const [items, total] = await Promise.all([
    db.awsResource.findMany({
      where: w,
      select: RESOURCE_LIST_SELECT,
      orderBy: [{ [sort.field]: { sort: sort.dir, nulls: "last" } }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.awsResource.count({ where: w }),
  ]);
  return { items, total };
}

/** All (non-deleted) resources of given types — for bounded views like the topology. */
export async function listAllResources(organizationId: string, types: string[], filter: { accountRefIds?: string[]; regions?: string[] } = {}, limit = 5000) {
  return getDb().awsResource.findMany({
    where: {
      organizationId,
      resourceType: { in: types },
      deletedAt: null,
      ...(filter.accountRefIds?.length ? { awsAccountRefId: { in: filter.accountRefIds } } : {}),
      ...(filter.regions?.length ? { region: { in: filter.regions } } : {}),
    },
    select: { id: true, resourceType: true, region: true, resourceId: true, name: true, state: true, attributes: true, awsAccountRefId: true },
    take: limit,
  });
}

/** Tenant-scoped single lookup by internal id. Cross-tenant ids return null. */
export async function findResource(organizationId: string, id: string) {
  return getDb().awsResource.findFirst({
    where: { id, organizationId },
    select: { ...RESOURCE_LIST_SELECT, tags: { select: { key: true, value: true }, orderBy: { key: "asc" as const } } },
  });
}

export async function findResourcesByAwsIds(organizationId: string, awsAccountRefId: string, type: string, resourceIds: string[]) {
  if (resourceIds.length === 0) return [];
  return getDb().awsResource.findMany({
    where: { organizationId, awsAccountRefId, resourceType: type, resourceId: { in: resourceIds.slice(0, 500) }, deletedAt: null },
    select: { id: true, resourceType: true, resourceId: true, name: true, state: true, region: true, attributes: true },
  });
}

export async function distinctValues(organizationId: string, types: string[], field: "region" | "state") {
  const where = { organizationId, resourceType: { in: types }, deletedAt: null };
  const values =
    field === "region"
      ? (await getDb().awsResource.groupBy({ by: ["region"], where, orderBy: { region: "asc" }, take: 200 })).map((r) => r.region)
      : (await getDb().awsResource.groupBy({ by: ["state"], where, orderBy: { state: "asc" }, take: 200 })).map((r) => r.state);
  return values.filter((v): v is string => Boolean(v));
}

export async function countByType(organizationId: string, filter: { accountRefIds?: string[]; regions?: string[] } = {}) {
  const rows = await getDb().awsResource.groupBy({
    by: ["resourceType"],
    where: {
      organizationId,
      deletedAt: null,
      ...(filter.accountRefIds?.length ? { awsAccountRefId: { in: filter.accountRefIds } } : {}),
      ...(filter.regions?.length ? { region: { in: filter.regions } } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.resourceType, r._count._all])) as Record<string, number>;
}

/** Allow-listed attribute keys that may be used for facet queries. */
const FACET_ATTRIBUTES = new Set(["instanceType", "vpcId", "engine", "runtime", "lbType"]);

export async function distinctAttribute(organizationId: string, resourceType: string, key: string): Promise<string[]> {
  if (!FACET_ATTRIBUTES.has(key)) return [];
  const rows = await getDb().$queryRaw<{ v: string | null }[]>`
    SELECT DISTINCT ("attributes" ->> ${key}) AS v FROM "aws_resources"
    WHERE "organizationId" = ${organizationId}::uuid AND "resourceType" = ${resourceType} AND "deletedAt" IS NULL
    ORDER BY v LIMIT 200`;
  return rows.map((r) => r.v).filter((v): v is string => Boolean(v));
}
