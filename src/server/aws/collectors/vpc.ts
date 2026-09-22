import "server-only";
import {
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcsCommand,
  EC2Client,
  type IpPermission,
} from "@aws-sdk/client-ec2";
import { RESOURCE_TYPES, type RouteTableAttrs, type SecurityGroupRule } from "@/lib/resource-types";
import { createAwsClient } from "../client-factory";
import { paginate } from "../paginate";
import { nameTag, tagsToRecord, type Collector, type CollectorContext, type NormalizedResource } from "./types";

async function withEc2<T>(ctx: CollectorContext, fn: (c: EC2Client) => Promise<T>): Promise<T> {
  const client = createAwsClient(EC2Client, ctx.session, ctx.region, "ec2");
  try {
    return await fn(client);
  } finally {
    client.destroy();
  }
}

const arn = (ctx: CollectorContext, kind: string, id: string) => `arn:aws:ec2:${ctx.region}:${ctx.accountId}:${kind}/${id}`;

export function normalizeIngress(perms: IpPermission[] | undefined): SecurityGroupRule[] {
  return (perms ?? []).map((p) => ({
    protocol: p.IpProtocol ?? "-1",
    fromPort: p.IpProtocol === "-1" ? null : (p.FromPort ?? null),
    toPort: p.IpProtocol === "-1" ? null : (p.ToPort ?? null),
    sources: [
      ...(p.IpRanges ?? []).filter((r) => r.CidrIp).map((r) => ({ type: "cidr" as const, value: r.CidrIp! })),
      ...(p.Ipv6Ranges ?? []).filter((r) => r.CidrIpv6).map((r) => ({ type: "ipv6" as const, value: r.CidrIpv6! })),
      ...(p.UserIdGroupPairs ?? []).filter((r) => r.GroupId).map((r) => ({ type: "sg" as const, value: r.GroupId! })),
      ...(p.PrefixListIds ?? []).filter((r) => r.PrefixListId).map((r) => ({ type: "prefix-list" as const, value: r.PrefixListId! })),
    ],
  }));
}

export const vpcCollector: Collector = {
  id: "ec2:vpc-network",
  resourceTypes: [
    RESOURCE_TYPES.VPC,
    RESOURCE_TYPES.SUBNET,
    RESOURCE_TYPES.ROUTE_TABLE,
    RESOURCE_TYPES.INTERNET_GATEWAY,
    RESOURCE_TYPES.NAT_GATEWAY,
    RESOURCE_TYPES.NETWORK_ACL,
    RESOURCE_TYPES.VPC_ENDPOINT,
  ],
  scope: "regional",
  iamAction: "ec2:DescribeVpcs",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      const out: NormalizedResource[] = [];
      const [vpcs, subnets, rts, igws, nats, acls, endpoints] = await Promise.all([
        paginate((NextToken) => ec2.send(new DescribeVpcsCommand({ NextToken })), (p) => ({ items: p.Vpcs, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeSubnetsCommand({ NextToken })), (p) => ({ items: p.Subnets, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeRouteTablesCommand({ NextToken })), (p) => ({ items: p.RouteTables, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeInternetGatewaysCommand({ NextToken })), (p) => ({ items: p.InternetGateways, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeNatGatewaysCommand({ NextToken })), (p) => ({ items: p.NatGateways, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeNetworkAclsCommand({ NextToken })), (p) => ({ items: p.NetworkAcls, nextToken: p.NextToken })),
        paginate((NextToken) => ec2.send(new DescribeVpcEndpointsCommand({ NextToken })), (p) => ({ items: p.VpcEndpoints, nextToken: p.NextToken })),
      ]);

      for (const v of vpcs) {
        if (!v.VpcId) continue;
        const tags = tagsToRecord(v.Tags);
        out.push({ resourceType: RESOURCE_TYPES.VPC, region: ctx.region, resourceId: v.VpcId, arn: arn(ctx, "vpc", v.VpcId), name: nameTag(tags), state: v.State ?? null, tags, attributes: { cidr: v.CidrBlock ?? null, isDefault: Boolean(v.IsDefault) }, searchTerms: v.CidrBlock ? [v.CidrBlock] : [] });
      }
      for (const s of subnets) {
        if (!s.SubnetId) continue;
        const tags = tagsToRecord(s.Tags);
        out.push({
          resourceType: RESOURCE_TYPES.SUBNET, region: ctx.region, resourceId: s.SubnetId, arn: arn(ctx, "subnet", s.SubnetId), name: nameTag(tags), state: s.State ?? "available", tags,
          attributes: { vpcId: s.VpcId ?? null, availabilityZone: s.AvailabilityZone ?? null, cidr: s.CidrBlock ?? null, mapPublicIpOnLaunch: Boolean(s.MapPublicIpOnLaunch), availableIps: s.AvailableIpAddressCount ?? null },
          searchTerms: s.CidrBlock ? [s.CidrBlock] : [],
        });
      }
      for (const r of rts) {
        if (!r.RouteTableId) continue;
        const tags = tagsToRecord(r.Tags);
        const routes: RouteTableAttrs["routes"] = (r.Routes ?? []).map((x) => {
          const target = x.GatewayId ?? x.NatGatewayId ?? x.TransitGatewayId ?? x.VpcPeeringConnectionId ?? x.NetworkInterfaceId ?? x.InstanceId ?? "unknown";
          const targetType = target === "local" ? "local" : target.startsWith("igw-") ? "igw" : x.NatGatewayId ? "nat" : "other";
          return { destination: x.DestinationCidrBlock ?? x.DestinationIpv6CidrBlock ?? x.DestinationPrefixListId ?? "?", target, targetType };
        });
        out.push({
          resourceType: RESOURCE_TYPES.ROUTE_TABLE, region: ctx.region, resourceId: r.RouteTableId, arn: arn(ctx, "route-table", r.RouteTableId), name: nameTag(tags), state: null, tags,
          attributes: {
            vpcId: r.VpcId ?? null,
            subnetIds: (r.Associations ?? []).map((a) => a.SubnetId).filter((x): x is string => Boolean(x)),
            main: (r.Associations ?? []).some((a) => a.Main),
            routes,
          } satisfies RouteTableAttrs,
        });
      }
      for (const g of igws) {
        if (!g.InternetGatewayId) continue;
        const tags = tagsToRecord(g.Tags);
        out.push({ resourceType: RESOURCE_TYPES.INTERNET_GATEWAY, region: ctx.region, resourceId: g.InternetGatewayId, arn: arn(ctx, "internet-gateway", g.InternetGatewayId), name: nameTag(tags), state: g.Attachments?.[0]?.State ?? "detached", tags, attributes: { vpcIds: (g.Attachments ?? []).map((a) => a.VpcId).filter((x): x is string => Boolean(x)) } });
      }
      for (const n of nats) {
        if (!n.NatGatewayId || n.State === "deleted") continue;
        const tags = tagsToRecord(n.Tags);
        const publicIps = (n.NatGatewayAddresses ?? []).map((a) => a.PublicIp).filter((x): x is string => Boolean(x));
        out.push({ resourceType: RESOURCE_TYPES.NAT_GATEWAY, region: ctx.region, resourceId: n.NatGatewayId, arn: arn(ctx, "natgateway", n.NatGatewayId), name: nameTag(tags), state: n.State ?? null, tags, attributes: { vpcId: n.VpcId ?? null, subnetId: n.SubnetId ?? null, publicIps }, searchTerms: publicIps });
      }
      for (const a of acls) {
        if (!a.NetworkAclId) continue;
        const tags = tagsToRecord(a.Tags);
        out.push({ resourceType: RESOURCE_TYPES.NETWORK_ACL, region: ctx.region, resourceId: a.NetworkAclId, arn: arn(ctx, "network-acl", a.NetworkAclId), name: nameTag(tags), state: null, tags, attributes: { vpcId: a.VpcId ?? null, isDefault: Boolean(a.IsDefault), subnetIds: (a.Associations ?? []).map((x) => x.SubnetId).filter((x): x is string => Boolean(x)), entryCount: a.Entries?.length ?? 0 } });
      }
      for (const e of endpoints) {
        if (!e.VpcEndpointId) continue;
        const tags = tagsToRecord(e.Tags);
        out.push({ resourceType: RESOURCE_TYPES.VPC_ENDPOINT, region: ctx.region, resourceId: e.VpcEndpointId, arn: arn(ctx, "vpc-endpoint", e.VpcEndpointId), name: nameTag(tags) ?? e.ServiceName ?? null, state: e.State ?? null, tags, attributes: { vpcId: e.VpcId ?? null, serviceName: e.ServiceName ?? null, endpointType: e.VpcEndpointType ?? null } });
      }
      return out;
    }),
};

export const securityGroupsCollector: Collector = {
  id: "ec2:security-groups",
  resourceTypes: [RESOURCE_TYPES.SECURITY_GROUP],
  scope: "regional",
  iamAction: "ec2:DescribeSecurityGroups",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      const groups = await paginate(
        (NextToken) => ec2.send(new DescribeSecurityGroupsCommand({ NextToken, MaxResults: 1000 })),
        (p) => ({ items: p.SecurityGroups, nextToken: p.NextToken }),
      );
      return groups
        .filter((g) => g.GroupId)
        .map((g) => {
          const tags = tagsToRecord(g.Tags);
          return {
            resourceType: RESOURCE_TYPES.SECURITY_GROUP,
            region: ctx.region,
            resourceId: g.GroupId!,
            arn: arn(ctx, "security-group", g.GroupId!),
            name: g.GroupName ?? nameTag(tags),
            state: null,
            tags,
            attributes: {
              vpcId: g.VpcId ?? null,
              description: g.Description?.slice(0, 255) ?? null,
              ingress: normalizeIngress(g.IpPermissions),
              egressRuleCount: g.IpPermissionsEgress?.length ?? 0,
            },
          };
        });
    }),
};
