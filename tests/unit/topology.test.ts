import { describe, expect, it } from "vitest";
import { buildTopology, type TopoResource } from "@/lib/topology";

const base = { awsAccountRefId: "acc", region: "us-east-1", state: null } as const;
const r = (resourceType: string, resourceId: string, attributes: unknown, name: string | null = null): TopoResource => ({ ...base, id: `${resourceType}:${resourceId}`, resourceType, resourceId, name, attributes });

describe("network topology", () => {
  const resources = [
    r("ec2:vpc", "vpc-1", { cidr: "10.0.0.0/16", isDefault: false }),
    r("ec2:subnet", "sub-pub", { vpcId: "vpc-1", cidr: "10.0.1.0/24", availabilityZone: "a", mapPublicIpOnLaunch: false, availableIps: 1 }),
    r("ec2:subnet", "sub-prv", { vpcId: "vpc-1", cidr: "10.0.2.0/24", availabilityZone: "a", mapPublicIpOnLaunch: true, availableIps: 1 }),
    r("ec2:route-table", "rtb-pub", { vpcId: "vpc-1", subnetIds: ["sub-pub"], main: false, routes: [{ destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" }] }),
    r("ec2:route-table", "rtb-main", { vpcId: "vpc-1", subnetIds: [], main: true, routes: [{ destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" }] }),
    r("ec2:internet-gateway", "igw-1", { vpcIds: ["vpc-1"] }),
    r("ec2:instance", "i-1", { subnetId: "sub-pub", vpcId: "vpc-1" }),
    r("ec2:instance", "i-2", { subnetId: "sub-prv", vpcId: "vpc-1" }),
    r("ec2:instance", "i-orphan", { subnetId: "sub-missing", vpcId: "vpc-1" }),
    r("rds:db-instance", "db-1", { vpcId: "vpc-1", subnetIds: ["sub-prv"] }),
  ];

  it("derives public/private from effective routes, not from auto-assign-IP flags", () => {
    const [region] = buildTopology(resources);
    const [vpc] = region!.vpcs;
    const pub = vpc!.subnets.find((s) => s.resourceId === "sub-pub")!;
    const prv = vpc!.subnets.find((s) => s.resourceId === "sub-prv")!;
    expect(pub.isPublic).toBe(true);
    expect(pub.publicReason).toContain("igw-1");
    // mapPublicIpOnLaunch=true but routed via NAT through the MAIN table → private.
    expect(prv.isPublic).toBe(false);
    expect(prv.routeTableId).toBe("rtb-main");
  });

  it("places instances only by their configured subnet and reports unplaced ones", () => {
    const [region] = buildTopology(resources);
    const [vpc] = region!.vpcs;
    expect(vpc!.subnets.find((s) => s.resourceId === "sub-pub")!.instances.map((i) => i.resourceId)).toEqual(["i-1"]);
    expect(vpc!.unplaced.map((i) => i.resourceId)).toEqual(["i-orphan"]);
    expect(vpc!.databases[0]!.subnetIds).toEqual(["sub-prv"]);
    expect(vpc!.internetGateways).toHaveLength(1);
  });

  it("never links resources across accounts or regions", () => {
    const other = { ...r("ec2:instance", "i-x", { subnetId: "sub-pub", vpcId: "vpc-1" }), awsAccountRefId: "other" };
    const [region] = buildTopology([...resources, other]);
    expect(region!.vpcs[0]!.subnets.flatMap((s) => s.instances.map((i) => i.resourceId))).not.toContain("i-x");
  });
});
