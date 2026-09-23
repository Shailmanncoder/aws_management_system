import "server-only";
import { RESOURCE_TYPES, type SecurityGroupAttrs, type SubnetAttrs } from "@/lib/resource-types";
import type { WalkthroughContext } from "@/lib/walkthroughs";
import { isKnownRegion } from "@/lib/regions";
import { isWorldOpen } from "@/lib/network";
import { assertCan, type OrgAccess } from "../authz/guard";
import { listAllResources } from "../repositories/resource-repository";

/**
 * Fills a walkthrough's `{{token}}` placeholders from the workspace's own inventory, so the
 * instructions name the reader's VPC and subnet rather than an invented example.
 *
 * Everything here is read from resources already synced for THIS organization — the same
 * tenant-scoped repository the inventory pages use — so no cross-tenant value can appear. When a
 * value is missing the token is left unresolved on purpose and the UI shows a hint; inventing a
 * plausible id would send someone to a resource that is not theirs.
 */

export interface WalkthroughContextInput {
  /** Region the reader is looking at, if any. */
  region?: string;
  /** The specific resource a remediation walkthrough was opened for. */
  resourceId?: string;
}

export async function getWalkthroughContext(access: OrgAccess, input: WalkthroughContextInput = {}): Promise<WalkthroughContext> {
  assertCan(access, "inventory:read");

  const ctx: WalkthroughContext = {};
  if (input.resourceId) ctx.resourceId = input.resourceId;

  const vpcs = await listAllResources(access.organizationId, [RESOURCE_TYPES.VPC], {}, 200);
  const region = isKnownRegion(input.region) ? input.region : preferredRegion(vpcs.map((v) => v.region));
  if (region) ctx.region = region;

  const vpc = vpcs.find((v) => v.region === region) ?? vpcs[0];
  if (!vpc) return ctx;
  ctx.vpcId = vpc.resourceId;
  ctx.region ??= vpc.region;

  const [subnets, groups] = await Promise.all([
    listAllResources(access.organizationId, [RESOURCE_TYPES.SUBNET], { regions: [vpc.region] }, 500),
    listAllResources(access.organizationId, [RESOURCE_TYPES.SECURITY_GROUP], { regions: [vpc.region] }, 500),
  ]);

  const inVpc = subnets.filter((s) => (s.attributes as unknown as SubnetAttrs).vpcId === vpc.resourceId);
  // A subnet that does not auto-assign a public IP is the right default for a new instance.
  const isPrivate = (s: (typeof inVpc)[number]) => !(s.attributes as unknown as SubnetAttrs).mapPublicIpOnLaunch;
  const privateSubnet = inVpc.find(isPrivate);
  const publicSubnet = inVpc.find((s) => !isPrivate(s));
  if (privateSubnet ?? inVpc[0]) ctx.subnetId = (privateSubnet ?? inVpc[0])!.resourceId;
  if (publicSubnet) ctx.publicSubnetId = publicSubnet.resourceId;

  // Suggest a group in the same VPC that is NOT open to the internet: suggesting an offending
  // group would walk the reader straight into the finding the security rules raise.
  const candidate = groups.find((g) => {
    const a = g.attributes as unknown as SecurityGroupAttrs;
    return a.vpcId === vpc.resourceId && !a.ingress.some(isWorldOpen) && g.name !== "default";
  });
  if (candidate) ctx.securityGroupId = candidate.resourceId;

  return ctx;
}

/** Most-used region wins, so the walkthrough opens where the reader's estate actually is. */
function preferredRegion(regions: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const r of regions) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [region, count] of counts) {
    if (count > bestCount) {
      best = region;
      bestCount = count;
    }
  }
  return best;
}
