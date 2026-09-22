import type {
  Ec2InstanceAttrs,
  InternetGatewayAttrs,
  LoadBalancerAttrs,
  NatGatewayAttrs,
  RdsInstanceAttrs,
  RouteTableAttrs,
  SubnetAttrs,
  VpcAttrs,
  VpcEndpointAttrs,
} from "./resource-types";

/**
 * Builds a network topology strictly from AWS configuration. No relationship is inferred from
 * naming, IP proximity or heuristics:
 *   subnet → VPC            : subnet.vpcId
 *   subnet → route table    : explicit association, else the VPC's main route table
 *   "public" subnet         : its effective route table has 0.0.0.0/0 or ::/0 → internet gateway
 *   instance → subnet       : instance.subnetId
 *   NAT gateway → subnet    : nat.subnetId
 *   IGW → VPC               : attachment
 *   DB / load balancer      : shown with their configured subnet set (placement within the set
 *                             is decided by AWS and is not guessed)
 */

export interface TopoResource {
  id: string;
  resourceType: string;
  region: string;
  resourceId: string;
  name: string | null;
  state: string | null;
  attributes: unknown;
  awsAccountRefId: string;
}

export interface TopoSubnet {
  id: string;
  resourceId: string;
  name: string | null;
  cidr: string | null;
  az: string | null;
  isPublic: boolean;
  publicReason: string;
  routeTableId: string | null;
  instances: TopoResource[];
  natGateways: TopoResource[];
}

export interface TopoVpc {
  vpc: TopoResource;
  cidr: string | null;
  isDefault: boolean;
  internetGateways: TopoResource[];
  subnets: TopoSubnet[];
  databases: { resource: TopoResource; subnetIds: string[] }[];
  loadBalancers: { resource: TopoResource; subnetIds: string[]; scheme: string | null }[];
  endpoints: TopoResource[];
  /** Resources whose subnet/VPC is not in the inventory (e.g. filtered or not yet synced). */
  unplaced: TopoResource[];
}

export interface TopoRegion {
  accountRefId: string;
  region: string;
  vpcs: TopoVpc[];
}

const WORLD = new Set(["0.0.0.0/0", "::/0"]);

export function buildTopology(resources: TopoResource[]): TopoRegion[] {
  const by = (t: string) => resources.filter((r) => r.resourceType === t);
  const key = (r: { awsAccountRefId: string; region: string }) => `${r.awsAccountRefId}|${r.region}`;

  const routeTables = by("ec2:route-table");
  const regions = new Map<string, TopoRegion>();

  for (const vpc of by("ec2:vpc")) {
    const va = vpc.attributes as VpcAttrs;
    const sameScope = (r: TopoResource) => r.awsAccountRefId === vpc.awsAccountRefId && r.region === vpc.region;
    const vpcRts = routeTables.filter((rt) => sameScope(rt) && (rt.attributes as RouteTableAttrs).vpcId === vpc.resourceId);
    const mainRt = vpcRts.find((rt) => (rt.attributes as RouteTableAttrs).main);

    const subnets: TopoSubnet[] = by("ec2:subnet")
      .filter((s) => sameScope(s) && (s.attributes as SubnetAttrs).vpcId === vpc.resourceId)
      .map((s) => {
        const sa = s.attributes as SubnetAttrs;
        const explicit = vpcRts.find((rt) => (rt.attributes as RouteTableAttrs).subnetIds.includes(s.resourceId));
        const rt = explicit ?? mainRt;
        const igwRoute = rt ? (rt.attributes as RouteTableAttrs).routes.find((x) => WORLD.has(x.destination) && x.targetType === "igw") : undefined;
        return {
          id: s.id,
          resourceId: s.resourceId,
          name: s.name,
          cidr: sa.cidr,
          az: sa.availabilityZone,
          isPublic: Boolean(igwRoute),
          publicReason: igwRoute
            ? `Route ${igwRoute.destination} → ${igwRoute.target} in ${rt!.resourceId}${explicit ? "" : " (main route table)"}`
            : rt
              ? `No internet-gateway default route in ${rt.resourceId}${explicit ? "" : " (main route table)"}`
              : "No route table found in inventory",
          routeTableId: rt?.resourceId ?? null,
          instances: by("ec2:instance").filter((i) => sameScope(i) && (i.attributes as Ec2InstanceAttrs).subnetId === s.resourceId),
          natGateways: by("ec2:nat-gateway").filter((n) => sameScope(n) && (n.attributes as NatGatewayAttrs).subnetId === s.resourceId),
        };
      })
      .sort((a, b) => Number(b.isPublic) - Number(a.isPublic) || (a.az ?? "").localeCompare(b.az ?? "") || (a.cidr ?? "").localeCompare(b.cidr ?? ""));

    const subnetIds = new Set(subnets.map((s) => s.resourceId));
    const instancesInVpc = by("ec2:instance").filter((i) => sameScope(i) && (i.attributes as Ec2InstanceAttrs).vpcId === vpc.resourceId);

    const topoVpc: TopoVpc = {
      vpc,
      cidr: va.cidr,
      isDefault: va.isDefault,
      internetGateways: by("ec2:internet-gateway").filter((g) => sameScope(g) && (g.attributes as InternetGatewayAttrs).vpcIds.includes(vpc.resourceId)),
      subnets,
      databases: by("rds:db-instance")
        .filter((d) => sameScope(d) && (d.attributes as RdsInstanceAttrs).vpcId === vpc.resourceId)
        .map((d) => ({ resource: d, subnetIds: (d.attributes as RdsInstanceAttrs).subnetIds })),
      loadBalancers: by("elb:load-balancer")
        .filter((l) => sameScope(l) && (l.attributes as LoadBalancerAttrs).vpcId === vpc.resourceId)
        .map((l) => ({ resource: l, subnetIds: (l.attributes as LoadBalancerAttrs).subnetIds, scheme: (l.attributes as LoadBalancerAttrs).scheme })),
      endpoints: by("ec2:vpc-endpoint").filter((e) => sameScope(e) && (e.attributes as VpcEndpointAttrs).vpcId === vpc.resourceId),
      unplaced: instancesInVpc.filter((i) => !subnetIds.has((i.attributes as Ec2InstanceAttrs).subnetId ?? "")),
    };

    const k = key(vpc);
    if (!regions.has(k)) regions.set(k, { accountRefId: vpc.awsAccountRefId, region: vpc.region, vpcs: [] });
    regions.get(k)!.vpcs.push(topoVpc);
  }
  return [...regions.values()].sort((a, b) => a.region.localeCompare(b.region));
}

export const TOPOLOGY_TYPES = [
  "ec2:vpc",
  "ec2:subnet",
  "ec2:route-table",
  "ec2:internet-gateway",
  "ec2:nat-gateway",
  "ec2:instance",
  "ec2:vpc-endpoint",
  "rds:db-instance",
  "elb:load-balancer",
] as const;
