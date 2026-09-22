import "server-only";
import { ALL_RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "@/lib/resource-types";
import { resourceHref } from "@/lib/resource-links";
import { assertCan, type OrgAccess } from "../authz/guard";
import { listResources } from "../repositories/resource-repository";

/**
 * Global resource search across all types, regions and accounts of the caller's workspace.
 * Matches name, id, ARN, IPs, DNS names, tags, region and account id via the trigram-indexed
 * searchText column (populated during sync). Results are tenant-scoped by construction.
 */
export async function searchResources(access: OrgAccess, q: string) {
  assertCan(access, "inventory:read");
  const term = q.trim().toLowerCase().replace(/[%\\]/g, "");
  if (term.length < 2) return [];
  const { items } = await listResources(access.organizationId, {
    types: [...ALL_RESOURCE_TYPES],
    search: term,
    sort: { field: "name", dir: "asc" },
    page: 1,
    pageSize: 15,
  });
  return items.map((r) => ({
    id: r.id,
    type: RESOURCE_TYPE_LABELS[r.resourceType as keyof typeof RESOURCE_TYPE_LABELS] ?? r.resourceType,
    name: r.name ?? r.resourceId,
    resourceId: r.resourceId,
    region: r.region,
    account: r.awsAccount.displayName,
    href: resourceHref(r.resourceType, r.id, r.resourceId),
  }));
}
