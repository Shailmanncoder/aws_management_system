import "server-only";
import {
  CreateSubnetCommand,
  CreateVpcCommand,
  DescribeAvailabilityZonesCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
  ModifyVpcAttributeCommand,
  type Subnet,
  type Vpc,
} from "@aws-sdk/client-ec2";
import { contains, formatCidr, overlaps, parseCidr, usableSubnetAddresses, type Ipv4Cidr } from "@/lib/cidr";
import type { Configuration, Review } from "@/lib/provisioning";
import type { SubnetAttrs, VpcAttrs } from "@/lib/resource-types";
import type { AwsSession } from "@/server/aws/session";
import type { NormalizedResource } from "@/server/aws/collectors/types";
import { reject } from "./safety";

/**
 * VPC and subnet provisioning.
 *
 * Networks are free to create, so the risks here are not financial — they are that a badly chosen
 * range cannot be changed afterwards (AWS does not allow a VPC's primary CIDR to be edited or a
 * subnet's CIDR to be resized), and that a subnet silently becomes internet-facing. So:
 *
 *  - CIDRs must be private RFC 1918 space and must not overlap anything that already exists in the
 *    region, which is what makes future peering, VPN and Transit Gateway attachments possible.
 *  - A subnet's range must sit inside its VPC's range and not collide with a sibling subnet.
 *  - `MapPublicIpOnLaunch` is never enabled. Stratus does not create internet gateways or routes,
 *    so a network it creates is private until someone deliberately opens it.
 *
 * Kept apart from `adapters.ts` so the EC2/S3 paths are untouched by this addition.
 */

export type NetworkConfiguration = Extract<Configuration, { service: "vpc" | "subnet" }>;

const config = (s: AwsSession, region: string, mutation = false) => ({
  region,
  credentials: s.credentialProvider,
  maxAttempts: mutation ? 1 : 3,
  retryMode: "standard" as const,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 20000 },
});

/** Server-owned tag that lets a lost create response be recovered without creating a duplicate. */
export const PLAN_TAG = "StratusPlanId";

const tagSpec = (resourceType: "vpc" | "subnet", tags: Record<string, string>, planId: string) => [
  {
    ResourceType: resourceType,
    Tags: [...Object.entries(tags).map(([Key, Value]) => ({ Key, Value })), { Key: PLAN_TAG, Value: planId }],
  },
];

function requireCidr(value: string): Ipv4Cidr {
  const parsed = parseCidr(value);
  if (!parsed) reject("The network range is not a valid CIDR block.");
  return parsed;
}

/** Every IPv4 range associated with a VPC, including secondary associations. */
function vpcRanges(vpc: Vpc): Ipv4Cidr[] {
  const raw = [vpc.CidrBlock, ...(vpc.CidrBlockAssociationSet ?? []).filter((a) => a.CidrBlockState?.State === "associated").map((a) => a.CidrBlock)];
  return raw.filter((c): c is string => Boolean(c)).map(parseCidr).filter((c): c is Ipv4Cidr => c !== null);
}

export async function networkPreflight(session: AwsSession, c: NetworkConfiguration, review: Review): Promise<Review> {
  const ec2 = new EC2Client(config(session, c.region));
  try {
    return c.service === "vpc" ? await vpcPreflight(ec2, session, c, review) : await subnetPreflight(ec2, session, c, review);
  } finally {
    ec2.destroy();
  }
}

async function vpcPreflight(ec2: EC2Client, session: AwsSession, c: Extract<Configuration, { service: "vpc" }>, review: Review): Promise<Review> {
  const wanted = requireCidr(c.cidr);

  const existing = await ec2.send(new DescribeVpcsCommand({ MaxResults: 100 }));
  const mine = (existing.Vpcs ?? []).filter((v) => v.OwnerId === session.accountId);
  for (const vpc of mine) {
    for (const range of vpcRanges(vpc)) {
      if (overlaps(range, wanted)) {
        reject(`This range overlaps ${vpc.VpcId ?? "an existing VPC"} (${formatCidr(range)}). Overlapping ranges cannot be peered or connected by VPN later.`);
      }
    }
  }

  await dryRun(() => ec2.send(new CreateVpcCommand({ CidrBlock: c.cidr, DryRun: true })), "VPC creation");

  review.requiredPermissions = ["ec2:CreateVpc", "ec2:CreateTags", "ec2:ModifyVpcAttribute", "ec2:DescribeVpcs"];
  review.estimatedMonthlyUsd = 0;
  review.networkExposure = "Private. No internet gateway, NAT gateway or route to the internet is created.";
  review.warnings = [
    "A VPC, its subnets and route tables are free. Cost begins when you add a NAT gateway (about USD 32 per month each), VPC endpoints or resources inside it.",
    "The primary CIDR block cannot be changed after creation. Additional ranges can be associated later, but this one is permanent.",
    "AWS automatically creates a default security group, route table and network ACL in every new VPC. The default security group allows unrestricted traffic between resources that share it.",
    `${mine.length} VPC${mine.length === 1 ? "" : "s"} already exist in ${c.region}. AWS applies a default quota of 5 VPCs per region.`,
  ];
  return review;
}

async function subnetPreflight(ec2: EC2Client, session: AwsSession, c: Extract<Configuration, { service: "subnet" }>, review: Review): Promise<Review> {
  const wanted = requireCidr(c.cidr);

  const vpcRes = await ec2.send(new DescribeVpcsCommand({ VpcIds: [c.vpcId] }));
  const vpc = vpcRes.Vpcs?.[0];
  if (!vpc || vpc.OwnerId !== session.accountId || vpc.State !== "available") {
    reject("Select an available VPC in this account and region.");
  }
  const ranges = vpcRanges(vpc);
  if (!ranges.some((range) => contains(range, wanted))) {
    const shown = ranges.map(formatCidr).join(", ") || "none";
    reject(`The subnet range must sit inside the VPC's range (${shown}).`);
  }

  const siblings = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [c.vpcId] }], MaxResults: 100 }));
  for (const subnet of siblings.Subnets ?? []) {
    const range = subnet.CidrBlock ? parseCidr(subnet.CidrBlock) : null;
    if (range && overlaps(range, wanted)) {
      reject(`This range overlaps the existing subnet ${subnet.SubnetId ?? ""} (${formatCidr(range)}).`);
    }
  }

  let zone = c.availabilityZone;
  const zones = await ec2.send(new DescribeAvailabilityZonesCommand({ Filters: [{ Name: "region-name", Values: [c.region] }] }));
  const usable = (zones.AvailabilityZones ?? []).filter((z) => z.State === "available" && z.ZoneType === "availability-zone");
  if (zone) {
    if (!usable.some((z) => z.ZoneName === zone)) reject("That Availability Zone is not available in this region.");
  } else {
    // Spread across zones the VPC is not yet using, so a two-AZ layout happens by default.
    const used = new Set((siblings.Subnets ?? []).map((s) => s.AvailabilityZone));
    zone = usable.find((z) => !used.has(z.ZoneName))?.ZoneName ?? usable[0]?.ZoneName;
  }
  if (!zone) reject("No Availability Zone is available in this region.");

  await dryRun(
    () => ec2.send(new CreateSubnetCommand({ VpcId: c.vpcId, CidrBlock: c.cidr, AvailabilityZone: zone, DryRun: true })),
    "subnet creation",
  );

  review.availabilityZone = zone;
  review.usableAddresses = usableSubnetAddresses(wanted);
  review.requiredPermissions = ["ec2:CreateSubnet", "ec2:CreateTags", "ec2:DescribeSubnets", "ec2:DescribeVpcs", "ec2:DescribeAvailabilityZones"];
  review.estimatedMonthlyUsd = 0;
  review.networkExposure = "Private. Auto-assign public IPv4 is disabled, and no route to an internet gateway is created.";
  review.warnings = [
    "Subnets are free. Anything launched inside one is not.",
    `AWS reserves 5 addresses in every subnet, leaving ${usableSubnetAddresses(wanted)} usable. A subnet's range cannot be resized after creation.`,
    "This subnet is private. It inherits the VPC's main route table, which has no internet route unless one was added to it.",
  ];
  if (ranges.length > 0 && usableSubnetAddresses(wanted) < 11) {
    review.warnings.push("This is a very small subnet. Load balancers require at least 8 free addresses per subnet.");
  }
  return review;
}

/** AWS signals a successful permission check by throwing DryRunOperation. */
async function dryRun(send: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await send();
  } catch (e) {
    if ((e as { name?: string }).name === "DryRunOperation") return;
    throw e;
  }
  reject(`AWS did not confirm the permission check for ${what}.`);
}

export async function createNetwork(
  session: AwsSession,
  c: NetworkConfiguration,
  review: Review,
  planId: string,
  checkpoint: (id: string) => Promise<void>,
): Promise<string> {
  const ec2 = new EC2Client(config(session, c.region, true));
  try {
    if (c.service === "vpc") {
      const res = await ec2.send(
        new CreateVpcCommand({
          CidrBlock: c.cidr,
          InstanceTenancy: "default",
          AmazonProvidedIpv6CidrBlock: false,
          TagSpecifications: tagSpec("vpc", review.tags, planId),
        }),
      );
      const id = res.Vpc?.VpcId;
      if (!id) reject("AWS did not return a VPC identifier. Reconciliation is required.");
      await checkpoint(id);
      // Both attributes are separate calls; AWS rejects setting them together.
      await ec2.send(new ModifyVpcAttributeCommand({ VpcId: id, EnableDnsSupport: { Value: true } }));
      await ec2.send(new ModifyVpcAttributeCommand({ VpcId: id, EnableDnsHostnames: { Value: c.enableDnsHostnames } }));
      return id;
    }

    const res = await ec2.send(
      new CreateSubnetCommand({
        VpcId: c.vpcId,
        CidrBlock: c.cidr,
        AvailabilityZone: review.availabilityZone ?? c.availabilityZone,
        TagSpecifications: tagSpec("subnet", review.tags, planId),
      }),
    );
    const id = res.Subnet?.SubnetId;
    if (!id) reject("AWS did not return a subnet identifier. Reconciliation is required.");
    await checkpoint(id);
    // MapPublicIpOnLaunch is false by default; it is deliberately never enabled here.
    return id;
  } finally {
    ec2.destroy();
  }
}

export async function verifyNetwork(session: AwsSession, c: NetworkConfiguration, review: Review, resourceId: string): Promise<NormalizedResource> {
  const ec2 = new EC2Client(config(session, c.region));
  try {
    return c.service === "vpc" ? await verifyVpc(ec2, session, c, review, resourceId) : await verifySubnet(ec2, session, c, review, resourceId);
  } finally {
    ec2.destroy();
  }
}

function checkTags(entity: { Tags?: { Key?: string; Value?: string }[] }, expected: Record<string, string>, what: string): Record<string, string> {
  const actual = Object.fromEntries((entity.Tags ?? []).map((t) => [t.Key, t.Value]));
  if (Object.entries(expected).some(([k, v]) => actual[k] !== v)) reject(`${what} tags do not match the approved plan.`);
  return actual as Record<string, string>;
}

async function verifyVpc(
  ec2: EC2Client,
  session: AwsSession,
  c: Extract<Configuration, { service: "vpc" }>,
  review: Review,
  resourceId: string,
): Promise<NormalizedResource> {
  const res = await ec2.send(new DescribeVpcsCommand({ VpcIds: [resourceId] }));
  const vpc = res.Vpcs?.[0];
  if (!vpc || vpc.OwnerId !== session.accountId || !["pending", "available"].includes(vpc.State ?? "")) {
    reject("The VPC is not yet verified as available. Reconcile this deployment.");
  }
  if (vpc.CidrBlock !== c.cidr) reject("VPC range does not match the approved plan.");
  if (vpc.IsDefault) reject("AWS returned the account's default VPC rather than the new one.");
  const tags = checkTags(vpc, review.tags, "VPC");

  return {
    resourceType: "ec2:vpc",
    region: c.region,
    resourceId,
    arn: `arn:aws:ec2:${c.region}:${session.accountId}:vpc/${resourceId}`,
    name: c.name,
    state: vpc.State ?? "available",
    tags,
    attributes: { cidr: vpc.CidrBlock ?? null, isDefault: false } satisfies VpcAttrs,
  };
}

async function verifySubnet(
  ec2: EC2Client,
  session: AwsSession,
  c: Extract<Configuration, { service: "subnet" }>,
  review: Review,
  resourceId: string,
): Promise<NormalizedResource> {
  const res = await ec2.send(new DescribeSubnetsCommand({ SubnetIds: [resourceId] }));
  const subnet = res.Subnets?.[0];
  if (!subnet || subnet.OwnerId !== session.accountId || !["pending", "available"].includes(subnet.State ?? "")) {
    reject("The subnet is not yet verified as available. Reconcile this deployment.");
  }
  if (subnet.VpcId !== c.vpcId || subnet.CidrBlock !== c.cidr) reject("Subnet placement does not match the approved plan.");
  if (subnet.MapPublicIpOnLaunch) reject("The subnet auto-assigns public IPv4 addresses, which the plan did not request.");
  if ((subnet.Ipv6CidrBlockAssociationSet ?? []).length > 0) reject("The subnet has an IPv6 range, which the plan did not request.");
  const tags = checkTags(subnet, review.tags, "Subnet");

  return {
    resourceType: "ec2:subnet",
    region: c.region,
    resourceId,
    arn: `arn:aws:ec2:${c.region}:${session.accountId}:subnet/${resourceId}`,
    name: c.name,
    state: subnet.State ?? "available",
    tags,
    attributes: {
      vpcId: subnet.VpcId ?? null,
      availabilityZone: subnet.AvailabilityZone ?? null,
      cidr: subnet.CidrBlock ?? null,
      mapPublicIpOnLaunch: false,
      availableIps: subnet.AvailableIpAddressCount ?? null,
    } satisfies SubnetAttrs,
  };
}

/**
 * Recovers the id of a resource whose create response was lost. Neither CreateVpc nor CreateSubnet
 * accepts a client token, so the server-owned plan id is written as a tag at creation time and
 * used to find the resource here.
 */
export async function locateNetwork(session: AwsSession, c: NetworkConfiguration, planId: string): Promise<string | null> {
  const ec2 = new EC2Client(config(session, c.region));
  try {
    const filters = [{ Name: `tag:${PLAN_TAG}`, Values: [planId] }];
    const found: (Vpc | Subnet)[] =
      c.service === "vpc"
        ? ((await ec2.send(new DescribeVpcsCommand({ Filters: filters }))).Vpcs ?? [])
        : ((await ec2.send(new DescribeSubnetsCommand({ Filters: filters }))).Subnets ?? []);
    if (found.some((r) => r.OwnerId !== session.accountId)) reject("Network account mismatch.");
    if (found.length > 1) reject("Multiple networks matched this plan. Manual investigation is required.");
    const first = found[0];
    if (!first) return null;
    return (c.service === "vpc" ? (first as Vpc).VpcId : (first as Subnet).SubnetId) ?? null;
  } finally {
    ec2.destroy();
  }
}

/** Counts customer VPCs across the connection's regions, for the workspace guardrail. */
export async function countVpcs(session: AwsSession, regions: string[]): Promise<number> {
  let count = 0;
  for (const region of regions) {
    const ec2 = new EC2Client(config(session, region));
    try {
      let NextToken: string | undefined;
      do {
        const res = await ec2.send(new DescribeVpcsCommand({ NextToken, MaxResults: 100 }));
        count += (res.Vpcs ?? []).filter((v) => v.OwnerId === session.accountId && !v.IsDefault).length;
        NextToken = res.NextToken;
      } while (NextToken);
    } finally {
      ec2.destroy();
    }
  }
  return count;
}
