import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CreateSubnetCommand,
  CreateVpcCommand,
  DescribeAvailabilityZonesCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
  ModifyVpcAttributeCommand,
  type DescribeAvailabilityZonesCommandOutput,
  type DescribeVpcsCommandOutput,
} from "@aws-sdk/client-ec2";
import { configurationSchema, DEFAULT_GUARDRAILS, type Configuration, type Review } from "@/lib/provisioning";
import { validateGuardrails } from "@/server/aws/provisioning/safety";
import { createNetwork, locateNetwork, networkPreflight, PLAN_TAG, verifyNetwork } from "@/server/aws/provisioning/network";
import { provisionerPolicy } from "@/server/aws/provisioning/template";
import { AwsSession } from "@/server/aws/session";

const ACCOUNT = "123456789012";
const ORG_ACCOUNT = "11111111-1111-4111-8111-111111111111";

const session = new AwsSession({
  accountId: ACCOUNT,
  partition: "aws",
  kind: "assumed-role",
  sessionName: "test",
  credentials: { accessKeyId: "test", secretAccessKey: "test", sessionToken: "test" },
});

const vpcConfig = (over: Record<string, unknown> = {}): Extract<Configuration, { service: "vpc" }> =>
  configurationSchema.parse({ service: "vpc", accountId: ORG_ACCOUNT, name: "core-network", region: "us-east-1", cidr: "10.20.0.0/16", ...over }) as Extract<Configuration, { service: "vpc" }>;

const subnetConfig = (over: Record<string, unknown> = {}): Extract<Configuration, { service: "subnet" }> =>
  configurationSchema.parse({
    service: "subnet",
    accountId: ORG_ACCOUNT,
    name: "app-private-a",
    region: "us-east-1",
    vpcId: "vpc-0abcdef012345678",
    cidr: "10.20.1.0/24",
    ...over,
  }) as Extract<Configuration, { service: "subnet" }>;

const blankReview = (name: string, service: string, region = "us-east-1"): Review => ({
  name,
  service,
  region,
  configuration: vpcConfig(),
  tags: { ManagedBy: "Stratus", ConnectionId: "connection", Name: name },
  networkExposure: "Private",
  requiredPermissions: [],
  warnings: [],
  estimatedMonthlyUsd: null,
});

const dryRunOk = () => Object.assign(new Error("Request would have succeeded"), { name: "DryRunOperation" });

const ec2 = mockClient(EC2Client);
beforeEach(() => ec2.reset());

describe("VPC configuration validation", () => {
  it("accepts a private in-range block", () => {
    expect(vpcConfig().cidr).toBe("10.20.0.0/16");
    expect(() => validateGuardrails(vpcConfig(), DEFAULT_GUARDRAILS, ["us-east-1"])).not.toThrow();
  });

  it("refuses public address space, oversized and undersized blocks, and host addresses", () => {
    for (const bad of ["8.8.8.0/24", "10.0.0.0/8", "10.0.0.0/30", "10.0.0.5/24", "not-a-cidr"]) {
      expect(() => vpcConfig({ cidr: bad }), bad).toThrow();
    }
  });

  it("refuses a region the workspace has not allowed", () => {
    expect(() => validateGuardrails(vpcConfig({ region: "eu-west-1" }), DEFAULT_GUARDRAILS, ["us-east-1"])).toThrow();
  });
});

describe("subnet configuration validation", () => {
  it("never allows auto-assigned public IPv4, even if asked", () => {
    expect(subnetConfig().mapPublicIpOnLaunch).toBe(false);
    expect(() => subnetConfig({ mapPublicIpOnLaunch: true })).toThrow();
  });

  it("validates the VPC id shape and the Availability Zone shape", () => {
    expect(() => subnetConfig({ vpcId: "vpc-../../evil" })).toThrow();
    expect(() => subnetConfig({ availabilityZone: "not-a-zone" })).toThrow();
    expect(subnetConfig({ availabilityZone: "us-east-1a" }).availabilityZone).toBe("us-east-1a");
  });
});

describe("VPC preflight", () => {
  it("refuses a range overlapping an existing VPC", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0existing0000001", OwnerId: ACCOUNT, CidrBlock: "10.20.0.0/24" }] });
    await expect(networkPreflight(session, vpcConfig(), blankReview("core-network", "vpc"))).rejects.toThrow(/overlaps/);
  });

  it("ignores VPCs owned by another account when checking overlap", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0other00000001", OwnerId: "999999999999", CidrBlock: "10.20.0.0/16" }] });
    ec2.on(CreateVpcCommand).rejects(dryRunOk());
    const review = await networkPreflight(session, vpcConfig(), blankReview("core-network", "vpc"));
    expect(review.estimatedMonthlyUsd).toBe(0);
  });

  it("reports zero cost, private exposure, and warns about permanence and NAT charges", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [] });
    ec2.on(CreateVpcCommand).rejects(dryRunOk());
    const review = await networkPreflight(session, vpcConfig(), blankReview("core-network", "vpc"));
    expect(review.estimatedMonthlyUsd).toBe(0);
    expect(review.networkExposure).toMatch(/No internet gateway/);
    expect(review.warnings.join(" ")).toMatch(/cannot be changed after creation/);
    expect(review.warnings.join(" ")).toMatch(/NAT gateway/);
    expect(review.requiredPermissions).toContain("ec2:CreateVpc");
  });

  it("fails when AWS does not confirm the dry-run permission check", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [] });
    ec2.on(CreateVpcCommand).resolves({ Vpc: { VpcId: "vpc-0should0not0be" } });
    await expect(networkPreflight(session, vpcConfig(), blankReview("core-network", "vpc"))).rejects.toThrow(/permission check/);
  });
});

describe("subnet preflight", () => {
  const vpcOk: Partial<DescribeVpcsCommandOutput> = { Vpcs: [{ VpcId: "vpc-0abcdef012345678", OwnerId: ACCOUNT, State: "available", CidrBlock: "10.20.0.0/16" }] };
  const zonesOk: Partial<DescribeAvailabilityZonesCommandOutput> = { AvailabilityZones: [{ ZoneName: "us-east-1a", State: "available", ZoneType: "availability-zone" }, { ZoneName: "us-east-1b", State: "available", ZoneType: "availability-zone" }] };

  it("refuses a range outside the VPC", async () => {
    ec2.on(DescribeVpcsCommand).resolves(vpcOk);
    await expect(networkPreflight(session, subnetConfig({ cidr: "192.168.1.0/24" }), blankReview("app", "subnet"))).rejects.toThrow(/inside the VPC/);
  });

  it("refuses a range overlapping a sibling subnet", async () => {
    ec2.on(DescribeVpcsCommand).resolves(vpcOk);
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: "subnet-0sibling00001", CidrBlock: "10.20.1.0/25", AvailabilityZone: "us-east-1a" }] });
    await expect(networkPreflight(session, subnetConfig(), blankReview("app", "subnet"))).rejects.toThrow(/overlaps the existing subnet/);
  });

  it("refuses a VPC owned by another account", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0abcdef012345678", OwnerId: "999999999999", State: "available", CidrBlock: "10.20.0.0/16" }] });
    await expect(networkPreflight(session, subnetConfig(), blankReview("app", "subnet"))).rejects.toThrow(/available VPC in this account/);
  });

  it("picks an unused Availability Zone and reports usable addresses", async () => {
    ec2.on(DescribeVpcsCommand).resolves(vpcOk);
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: "subnet-0existing0001", CidrBlock: "10.20.9.0/24", AvailabilityZone: "us-east-1a" }] });
    ec2.on(DescribeAvailabilityZonesCommand).resolves(zonesOk);
    ec2.on(CreateSubnetCommand).rejects(dryRunOk());
    const review = await networkPreflight(session, subnetConfig(), blankReview("app", "subnet"));
    expect(review.availabilityZone).toBe("us-east-1b");
    expect(review.usableAddresses).toBe(251);
    expect(review.estimatedMonthlyUsd).toBe(0);
    expect(review.networkExposure).toMatch(/Auto-assign public IPv4 is disabled/);
  });

  it("refuses an Availability Zone that is not in the region", async () => {
    ec2.on(DescribeVpcsCommand).resolves(vpcOk);
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [] });
    ec2.on(DescribeAvailabilityZonesCommand).resolves(zonesOk);
    await expect(networkPreflight(session, subnetConfig({ availabilityZone: "eu-west-1a" }), blankReview("app", "subnet"))).rejects.toThrow(/not available in this region/);
  });
});

describe("creation", () => {
  it("tags the VPC with the plan id and enables DNS in two separate calls", async () => {
    ec2.on(CreateVpcCommand).resolves({ Vpc: { VpcId: "vpc-0new000000000001" } });
    ec2.on(ModifyVpcAttributeCommand).resolves({});
    const checkpointed: string[] = [];
    const id = await createNetwork(session, vpcConfig(), blankReview("core-network", "vpc"), "plan-123", async (r) => void checkpointed.push(r));

    expect(id).toBe("vpc-0new000000000001");
    expect(checkpointed).toEqual(["vpc-0new000000000001"]);
    const input = ec2.commandCalls(CreateVpcCommand)[0]!.args[0].input;
    expect(input.CidrBlock).toBe("10.20.0.0/16");
    expect(input.AmazonProvidedIpv6CidrBlock).toBe(false);
    expect(input.TagSpecifications?.[0]?.Tags).toContainEqual({ Key: PLAN_TAG, Value: "plan-123" });
    // Both attributes must be set, and AWS rejects setting them in one call.
    expect(ec2.commandCalls(ModifyVpcAttributeCommand)).toHaveLength(2);
  });

  it("creates a subnet in the reviewed zone and never enables public IP assignment", async () => {
    ec2.on(CreateSubnetCommand).resolves({ Subnet: { SubnetId: "subnet-0new00000001" } });
    const review = { ...blankReview("app", "subnet"), availabilityZone: "us-east-1b" };
    const id = await createNetwork(session, subnetConfig(), review, "plan-456", async () => undefined);

    expect(id).toBe("subnet-0new00000001");
    const input = ec2.commandCalls(CreateSubnetCommand)[0]!.args[0].input;
    expect(input.AvailabilityZone).toBe("us-east-1b");
    expect(JSON.stringify(input)).not.toContain("MapPublicIpOnLaunch");
  });
});

describe("verification", () => {
  const tags = [
    { Key: "ManagedBy", Value: "Stratus" },
    { Key: "ConnectionId", Value: "connection" },
    { Key: "Name", Value: "app-private-a" },
  ];

  it("rejects a subnet that auto-assigns public IPv4", async () => {
    ec2.on(DescribeSubnetsCommand).resolves({
      Subnets: [{ SubnetId: "subnet-0new00000001", OwnerId: ACCOUNT, State: "available", VpcId: "vpc-0abcdef012345678", CidrBlock: "10.20.1.0/24", MapPublicIpOnLaunch: true, Tags: tags }],
    });
    const review = { ...blankReview("app-private-a", "subnet"), tags: { ManagedBy: "Stratus", ConnectionId: "connection", Name: "app-private-a" } };
    await expect(verifyNetwork(session, subnetConfig(), review, "subnet-0new00000001")).rejects.toThrow(/auto-assigns public IPv4/);
  });

  it("rejects a resource owned by a different account", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0new000000000001", OwnerId: "999999999999", State: "available", CidrBlock: "10.20.0.0/16" }] });
    await expect(verifyNetwork(session, vpcConfig(), blankReview("core-network", "vpc"), "vpc-0new000000000001")).rejects.toThrow(/not yet verified/);
  });

  it("rejects the account's default VPC being returned", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0default0000001", OwnerId: ACCOUNT, State: "available", CidrBlock: "10.20.0.0/16", IsDefault: true, Tags: tags }] });
    await expect(verifyNetwork(session, vpcConfig(), blankReview("core-network", "vpc"), "vpc-0default0000001")).rejects.toThrow(/default VPC/);
  });

  it("rejects a range that does not match the approved plan", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0new000000000001", OwnerId: ACCOUNT, State: "available", CidrBlock: "10.99.0.0/16", Tags: tags }] });
    await expect(verifyNetwork(session, vpcConfig(), blankReview("core-network", "vpc"), "vpc-0new000000000001")).rejects.toThrow(/does not match the approved plan/);
  });

  it("returns a normalised subnet on success", async () => {
    ec2.on(DescribeSubnetsCommand).resolves({
      Subnets: [
        {
          SubnetId: "subnet-0new00000001",
          OwnerId: ACCOUNT,
          State: "available",
          VpcId: "vpc-0abcdef012345678",
          CidrBlock: "10.20.1.0/24",
          MapPublicIpOnLaunch: false,
          AvailabilityZone: "us-east-1b",
          AvailableIpAddressCount: 251,
          Tags: tags,
        },
      ],
    });
    const review = { ...blankReview("app-private-a", "subnet"), tags: { ManagedBy: "Stratus", ConnectionId: "connection", Name: "app-private-a" } };
    const resource = await verifyNetwork(session, subnetConfig(), review, "subnet-0new00000001");
    expect(resource.resourceType).toBe("ec2:subnet");
    expect(resource.arn).toBe(`arn:aws:ec2:us-east-1:${ACCOUNT}:subnet/subnet-0new00000001`);
    expect(resource.attributes).toMatchObject({ vpcId: "vpc-0abcdef012345678", mapPublicIpOnLaunch: false, availabilityZone: "us-east-1b" });
  });
});

describe("recovery after a lost create response", () => {
  it("finds the resource by its plan tag", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0recovered00001", OwnerId: ACCOUNT }] });
    expect(await locateNetwork(session, vpcConfig(), "plan-123")).toBe("vpc-0recovered00001");
    expect(ec2.commandCalls(DescribeVpcsCommand)[0]!.args[0].input.Filters).toEqual([{ Name: `tag:${PLAN_TAG}`, Values: ["plan-123"] }]);
  });

  it("returns null when nothing was created", async () => {
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [] });
    expect(await locateNetwork(session, subnetConfig(), "plan-456")).toBeNull();
  });

  it("refuses to guess when several resources match", async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-0a0000000000001", OwnerId: ACCOUNT }, { VpcId: "vpc-0b0000000000002", OwnerId: ACCOUNT }] });
    await expect(locateNetwork(session, vpcConfig(), "plan-123")).rejects.toThrow(/Manual investigation/);
  });
});

describe("provisioner IAM policy for networks", () => {
  const policy = provisionerPolicy(ACCOUNT, "conn-1", DEFAULT_GUARDRAILS);
  const statements = policy.Statement as { Sid: string; Effect: string; Action: string[]; Resource: unknown; Condition?: Record<string, Record<string, unknown>> }[];
  const byId = (sid: string) => statements.find((s) => s.Sid === sid)!;

  it("grants creation only with the Stratus tags in the request", () => {
    const create = byId("CreateNetworks");
    expect(create.Action).toEqual(["ec2:CreateVpc", "ec2:CreateSubnet"]);
    expect(create.Condition?.StringEquals?.["aws:RequestTag/ManagedBy"]).toBe("Stratus");
    expect(create.Condition?.StringEquals?.["aws:RequestTag/ConnectionId"]).toBe("conn-1");
  });

  it("allows post-creation changes only on resources Stratus created", () => {
    const modify = byId("ConfigureCreatedVpcs");
    expect(modify.Action).toEqual(["ec2:ModifyVpcAttribute"]);
    expect(modify.Condition?.StringEquals?.["ec2:ResourceTag/ManagedBy"]).toBe("Stratus");
  });

  it("allows tagging only as part of a create call", () => {
    expect(byId("NetworkCreationTagsOnly").Condition?.StringEquals?.["ec2:CreateAction"]).toEqual(["CreateVpc", "CreateSubnet"]);
  });

  it("grants no deletion, gateway, routing or peering permission anywhere", () => {
    const granted = statements.flatMap((s) => s.Action);
    for (const forbidden of [
      "ec2:DeleteVpc",
      "ec2:DeleteSubnet",
      "ec2:CreateInternetGateway",
      "ec2:AttachInternetGateway",
      "ec2:CreateRoute",
      "ec2:CreateRouteTable",
      "ec2:CreateNatGateway",
      "ec2:ModifySubnetAttribute",
      "ec2:CreateVpcPeeringConnection",
      "iam:PassRole",
    ]) {
      expect(granted, forbidden).not.toContain(forbidden);
    }
    expect(statements.every((s) => s.Effect === "Allow")).toBe(true);
    expect(JSON.stringify(policy)).not.toContain('"*:*"');
  });
});
