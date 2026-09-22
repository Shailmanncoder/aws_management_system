import "server-only";
import { buildTopology, TOPOLOGY_TYPES, type TopoResource } from "@/lib/topology";
import { assertCan, type OrgAccess } from "../authz/guard";
import { listAccounts } from "../repositories/aws-account-repository";
import { listAllResources } from "../repositories/resource-repository";

/** Tenant-scoped topology; bounded to 5,000 network resources per view. */
export async function getTopology(access: OrgAccess, filter: { accountRefIds?: string[]; regions?: string[]; vpcId?: string }) {
  assertCan(access, "inventory:read");
  const [resources, accounts] = await Promise.all([
    listAllResources(access.organizationId, [...TOPOLOGY_TYPES], filter),
    listAccounts(access.organizationId),
  ]);
  let regions = buildTopology(resources as TopoResource[]);
  if (filter.vpcId) {
    regions = regions.map((r) => ({ ...r, vpcs: r.vpcs.filter((v) => v.vpc.resourceId === filter.vpcId) })).filter((r) => r.vpcs.length > 0);
  }
  return { regions, accountNames: Object.fromEntries(accounts.map((a) => [a.id, `${a.displayName} (${a.awsAccountId})`])), truncated: resources.length >= 5000 };
}
