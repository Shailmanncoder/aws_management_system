import "server-only";
import { z } from "zod";
import { ALL_RESOURCE_TYPES, type ResourceType } from "@/lib/resource-types";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { notFound } from "../errors";
import { countByType, distinctAttribute, distinctValues, findResource, findResourcesByAwsIds, listResources, type ResourceQuery, type ResourceRow } from "../repositories/resource-repository";
import { regionSchema, searchTermSchema, tagFilterSchema, uuidSchema } from "../validation/common";

/**
 * URL filter parsing. Each parameter is validated independently; invalid values are DROPPED
 * (falling back to defaults) so a manipulated query string can never reach the database as-is.
 */
const PARAM_SCHEMAS = {
  unowned: z.literal("true"),
  q: searchTermSchema.transform((s) => s.replace(/[%\\]/g, "")),
  account: uuidSchema,
  region: regionSchema,
  state: z.string().regex(/^[a-z][a-z-]{1,31}$/),
  type: z.enum(ALL_RESOURCE_TYPES as unknown as [ResourceType, ...ResourceType[]]),
  tag: tagFilterSchema,
  vpc: z.string().regex(/^vpc-[0-9a-z]{3,32}$/),
  instanceType: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/),
  sort: z.enum(["name", "resourceId", "region", "state", "lastSeenAt", "firstSeenAt"]),
  dir: z.enum(["asc", "desc"]),
  page: z.coerce.number().int().min(1).max(10_000),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)),
} as const;

type ParamKey = keyof typeof PARAM_SCHEMAS;
export type ListParams = { [K in ParamKey]?: z.infer<(typeof PARAM_SCHEMAS)[K]> };

export function parseListParams(raw: Record<string, string | string[] | undefined>): ListParams {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(PARAM_SCHEMAS) as ParamKey[]) {
    const v = raw[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value === undefined || value === "") continue;
    const parsed = PARAM_SCHEMAS[key].safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as ListParams;
}

export function toResourceDto(r: ResourceRow) {
  return {
    id: r.id,
    resourceType: r.resourceType as ResourceType,
    region: r.region,
    resourceId: r.resourceId,
    arn: r.arn,
    name: r.name,
    state: r.state,
    attributes: r.attributes as Record<string, unknown>,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    account: r.awsAccount,
    tags: r.tags,
  };
}
export type ResourceDto = ReturnType<typeof toResourceDto>;

export async function listInventory(access: OrgAccess, types: ResourceType[], params: ListParams) {
  assertCan(access, "inventory:read");
  const attributeEquals: Record<string, string> = {};
  if (params.vpc) attributeEquals.vpcId = params.vpc;
  if (params.instanceType) attributeEquals.instanceType = params.instanceType;
  const tag = params.tag ? { key: params.tag.split("=")[0]!, value: params.tag.includes("=") ? params.tag.slice(params.tag.indexOf("=") + 1) : undefined } : undefined;
  const owners = params.unowned ? await getDb().workspaceRecord.findMany({ where: { organizationId: access.organizationId, kind: "OWNER", resourceId: { not: null } }, select: { resourceId: true } }) : null;
  const query: ResourceQuery = {
    unownedIds: owners?.flatMap(r => r.resourceId ? [r.resourceId] : []),
    types: params.type && types.includes(params.type) ? [params.type] : types,
    accountRefIds: params.account ? [params.account] : undefined,
    regions: params.region ? [params.region] : undefined,
    states: params.state ? [params.state] : undefined,
    search: params.q,
    tag,
    attributeEquals,
    sort: params.sort ? { field: params.sort, dir: params.dir ?? "asc" } : undefined,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
  };
  const { items, total } = await listResources(access.organizationId, query);
  return { items: items.map(toResourceDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getResourceDetail(access: OrgAccess, id: string) {
  assertCan(access, "inventory:read");
  const r = await findResource(access.organizationId, id);
  if (!r) throw notFound("Resource");
  return toResourceDto(r);
}

export async function getFacets(access: OrgAccess, types: ResourceType[]) {
  assertCan(access, "inventory:read");
  const [regions, states] = await Promise.all([distinctValues(access.organizationId, types, "region"), distinctValues(access.organizationId, types, "state")]);
  return { regions, states };
}

export async function getTypeCounts(access: OrgAccess, filter: { accountRefIds?: string[]; regions?: string[] } = {}) {
  assertCan(access, "inventory:read");
  return countByType(access.organizationId, filter);
}

export async function getAttributeFacet(access: OrgAccess, type: ResourceType, key: string) {
  assertCan(access, "inventory:read");
  return distinctAttribute(access.organizationId, type, key);
}

/** Related resources of the SAME account (e.g. an instance's volumes / security groups). */
export async function getRelated(access: OrgAccess, accountRefId: string, type: ResourceType, awsIds: string[]) {
  assertCan(access, "inventory:read");
  return findResourcesByAwsIds(access.organizationId, accountRefId, type, awsIds);
}
