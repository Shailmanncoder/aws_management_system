import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import { EC2Client, RunInstancesCommand } from "@aws-sdk/client-ec2";
import {
  configurationSchema,
  DEFAULT_GUARDRAILS,
  bucketNameSchema,
  type Review,
} from "@/lib/provisioning";
import {
  hash,
  validateGuardrails,
  validateSecurityGroups,
  safeAwsError,
} from "@/server/aws/provisioning/safety";
import {
  createResource,
  preflight,
  runInput,
} from "@/server/aws/provisioning/adapters";
import {
  provisionerPolicy,
  provisionerTemplate,
} from "@/server/aws/provisioning/template";
import { AwsSession } from "@/server/aws/session";
import { hasPermission } from "@/lib/rbac";
const ec2Config = configurationSchema.parse({
  service: "ec2",
  accountId: "11111111-1111-4111-8111-111111111111",
  name: "test",
  region: "us-east-1",
  architecture: "x86_64",
  instanceType: "t3.micro",
  vpcId: "vpc-12345678",
  subnetId: "subnet-12345678",
  securityGroupIds: ["sg-12345678"],
  storageGiB: 8,
});
const bucket = configurationSchema.parse({
  service: "s3",
  accountId: ec2Config.accountId,
  name: "stratus-test-bucket",
  region: "us-east-1",
});
const review: Review = {
  name: bucket.name,
  service: "s3",
  region: bucket.region,
  configuration: bucket,
  tags: { ManagedBy: "Stratus", ConnectionId: "connection" },
  networkExposure: "Private",
  requiredPermissions: [],
  warnings: [],
  estimatedMonthlyUsd: null,
};
const session = new AwsSession({
  accountId: "123456789012",
  partition: "aws",
  kind: "assumed-role",
  sessionName: "test",
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
    sessionToken: "test",
  },
});
const s3 = mockClient(S3Client),
  ec2 = mockClient(EC2Client);
beforeEach(() => {
  s3.reset();
  ec2.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("provisioning guardrails", () => {
  it("rejects untrusted fields, encryption opt-outs and public S3", () => {
    for (const extra of [
      { imageId: "ami-bad" },
      { roleArn: "arn:bad" },
      { encrypted: false },
      { userData: "script" },
    ])
      expect(
        configurationSchema.safeParse({ ...ec2Config, ...extra }).success,
      ).toBe(false);
    expect(
      configurationSchema.safeParse({ ...bucket, public: true }).success,
    ).toBe(false);
  });
  it("enforces region, instance, storage, architecture and exposure", () => {
    for (const c of [
      { ...ec2Config, region: "eu-west-1" },
      { ...ec2Config, storageGiB: 101 },
      { ...ec2Config, architecture: "arm64" },
      { ...ec2Config, publicIpv4: true },
    ])
      expect(() =>
        validateGuardrails(c as typeof ec2Config, DEFAULT_GUARDRAILS, [
          "us-east-1",
        ]),
      ).toThrow();
    expect(() =>
      validateGuardrails(ec2Config, DEFAULT_GUARDRAILS, ["us-east-1"]),
    ).not.toThrow();
  });
  it("requires reserved tags and validates names", () => {
    expect(
      configurationSchema.safeParse({
        ...bucket,
        tags: [{ key: "ManagedBy", value: "other" }],
      }).success,
    ).toBe(false);
    for (const n of [
      "ab",
      "UPPER",
      "a..b",
      "xn--bucket",
      "test--x-s3",
      "amzn-s3-demo-x",
    ])
      expect(bucketNameSchema.safeParse(n).success).toBe(false);
  });
  it("hash is stable across property ordering and sensitive to changes", () => {
    expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
    expect(hash({ a: 1 })).not.toBe(hash({ a: 2 }));
  });
  it("blocks public SSH, IPv6 and disguised broad CIDRs and prefix lists", () => {
    if (ec2Config.service !== "ec2") throw Error();
    for (const permission of [
      {
        IpProtocol: "tcp",
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: "0.0.0.0/0" }],
      },
      {
        IpProtocol: "tcp",
        FromPort: 3389,
        ToPort: 3389,
        Ipv6Ranges: [{ CidrIpv6: "::/0" }],
      },
      { IpProtocol: "-1", IpRanges: [{ CidrIp: "10.0.0.0/0" }] },
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        PrefixListIds: [{ PrefixListId: "pl-1" }],
      },
    ])
      expect(() =>
        validateSecurityGroups(
          [
            {
              GroupId: "sg-12345678",
              VpcId: ec2Config.vpcId,
              OwnerId: session.accountId,
              IpPermissions: [permission],
            },
          ],
          ec2Config,
          session.accountId,
        ),
      ).toThrow();
  });
  it("rejects security group account substitution", () => {
    if (ec2Config.service !== "ec2") throw Error();
    expect(() =>
      validateSecurityGroups(
        [
          {
            GroupId: "sg-12345678",
            VpcId: ec2Config.vpcId,
            OwnerId: "999999999999",
          },
        ],
        ec2Config,
        session.accountId,
      ),
    ).toThrow();
  });
  it("separates application permissions", () => {
    for (const r of [
      "VIEWER",
      "OPERATOR",
      "BILLING_VIEWER",
      "SECURITY_VIEWER",
    ] as const)
      expect(hasPermission(r, "provisioning:create")).toBe(false);
    expect(hasPermission("PROVISIONER", "provisioning:create")).toBe(true);
    expect(hasPermission("PROVISIONER", "provisioning:configure")).toBe(false);
    expect(hasPermission("ADMIN", "provisioning:configure")).toBe(true);
  });
});
describe("creation adapters", () => {
  it("creates an encrypted private bucket in the correct order without a us-east-1 location constraint", async () => {
    s3.resolves({});
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    await createResource(session, bucket, review, "token", checkpoint);
    expect(s3.calls().map((c) => c.args[0].constructor.name)).toEqual([
      "CreateBucketCommand",
      "PutPublicAccessBlockCommand",
      "PutBucketEncryptionCommand",
      "PutBucketVersioningCommand",
      "PutBucketTaggingCommand",
    ]);
    expect(
      s3.commandCalls(CreateBucketCommand)[0].args[0].input
        .CreateBucketConfiguration,
    ).toBeUndefined();
    expect(
      s3.commandCalls(PutPublicAccessBlockCommand)[0].args[0].input
        .PublicAccessBlockConfiguration,
    ).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });
    expect(
      s3.commandCalls(PutBucketEncryptionCommand)[0].args[0].input
        .ExpectedBucketOwner,
    ).toBe(session.accountId);
    expect(checkpoint).toHaveBeenCalledWith(bucket.name);
  });
  it("does not change a bucket when creation conflicts", async () => {
    s3.on(CreateBucketCommand).rejects({ name: "BucketAlreadyOwnedByYou" });
    await expect(
      createResource(session, bucket, review, "token", vi.fn()),
    ).rejects.toThrow();
    expect(s3.commandCalls(PutPublicAccessBlockCommand)).toHaveLength(0);
  });
  it("records the created resource before a partial configuration failure", async () => {
    s3.on(CreateBucketCommand).resolves({});
    s3.on(PutPublicAccessBlockCommand).rejects({ name: "AccessDenied" });
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    await expect(
      createResource(session, bucket, review, "token", checkpoint),
    ).rejects.toThrow();
    expect(checkpoint).toHaveBeenCalledWith(bucket.name);
    expect(s3.commandCalls(CreateBucketCommand)).toHaveLength(1);
    expect(s3.commandCalls(PutBucketTaggingCommand)).toHaveLength(0);
  });
  it("never adopts an existing bucket during planning", async () => {
    s3.on(HeadBucketCommand).resolves({});
    await expect(
      preflight(session, bucket, review.tags, "token"),
    ).rejects.toThrow(/already exists/);
    expect(s3.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });
  it("uses EC2 idempotency, single-instance bounds and secure launch inputs", async () => {
    if (ec2Config.service !== "ec2") throw Error();
    const r = {
      ...review,
      imageId: "ami-approved",
      rootDeviceName: "/dev/xvda",
    };
    const input = runInput(ec2Config, r, "stable-token");
    expect(input).toMatchObject({
      ClientToken: "stable-token",
      MinCount: 1,
      MaxCount: 1,
      ImageId: "ami-approved",
      MetadataOptions: { HttpTokens: "required" },
      NetworkInterfaces: [{ AssociatePublicIpAddress: false }],
      BlockDeviceMappings: [{ Ebs: { Encrypted: true } }],
    });
    expect(input.IamInstanceProfile).toBeUndefined();
    ec2
      .on(RunInstancesCommand)
      .resolves({ Instances: [{ InstanceId: "i-123" }] });
    await createResource(session, ec2Config, r, "stable-token", vi.fn());
    expect(ec2.commandCalls(RunInstancesCommand)).toHaveLength(1);
  });
  it("sanitizes AWS details", () => {
    const e = Object.assign(new Error("SECRET token and account data"), {
      name: "AccessDenied",
    });
    expect(safeAwsError(e).publicMessage).not.toContain("SECRET");
  });
});
describe("IAM template", () => {
  it("only creates a separate provisioner role with ExternalId trust", () => {
    const t = JSON.parse(
      provisionerTemplate(
        "arn:aws:iam::111111111111:role/Platform",
        "unique-external",
        "123456789012",
        "connection",
        DEFAULT_GUARDRAILS,
      ),
    );
    expect(Object.keys(t.Resources)).toEqual(["StratusProvisionerRole"]);
    expect(
      t.Resources.StratusProvisionerRole.Properties.AssumeRolePolicyDocument
        .Statement[0].Condition.StringEquals["sts:ExternalId"],
    ).toBe("unique-external");
    expect(t.Outputs.RoleArn).toBeDefined();
  });
  it("has no wildcard actions, PassRole, deletion, public ACL or read-role changes", () => {
    const p = provisionerPolicy(
      "123456789012",
      "connection",
      DEFAULT_GUARDRAILS,
    );
    for (const s of p.Statement)
      for (const action of s.Action)
        expect(action).not.toMatch(
          /\*|Delete|Terminate|PassRole|PutBucketAcl|PutBucketPolicy/,
        );
    const ec = p.Statement.find((s) => s.Sid === "EncryptedVolumes")!;
    expect(JSON.stringify(ec)).toContain('"ec2:Encrypted":"true"');
    expect(JSON.stringify(p)).toContain("stratus-connection-*");
  });
});

describe("EC2 preflight", () => {
  it("resolves an approved AMI server-side and performs a dry-run", async () => {
    const {
      DescribeImagesCommand,
      DescribeInstanceTypesCommand,
      DescribeSubnetsCommand,
      DescribeSecurityGroupsCommand,
    } = await import("@aws-sdk/client-ec2");
    const { PricingClient } = await import("@aws-sdk/client-pricing");
    const pricing = mockClient(PricingClient);
    pricing.resolves({ PriceList: [] });
    ec2
      .on(DescribeImagesCommand)
      .resolves({
        Images: [
          {
            ImageId: "ami-approved",
            State: "available",
            Architecture: "x86_64",
            RootDeviceType: "ebs",
            VirtualizationType: "hvm",
            RootDeviceName: "/dev/xvda",
            BlockDeviceMappings: [
              { DeviceName: "/dev/xvda", Ebs: { VolumeSize: 8 } },
            ],
          },
        ],
      });
    ec2
      .on(DescribeInstanceTypesCommand)
      .resolves({
        InstanceTypes: [
          {
            ProcessorInfo: { SupportedArchitectures: ["x86_64"] },
            VCpuInfo: { DefaultVCpus: 2 },
            MemoryInfo: { SizeInMiB: 1024 },
          },
        ],
      });
    ec2
      .on(DescribeSubnetsCommand)
      .resolves({
        Subnets: [
          {
            SubnetId: "subnet-12345678",
            VpcId: "vpc-12345678",
            OwnerId: session.accountId,
            State: "available",
            AssignIpv6AddressOnCreation: false,
          },
        ],
      });
    ec2
      .on(DescribeSecurityGroupsCommand)
      .resolves({
        SecurityGroups: [
          {
            GroupId: "sg-12345678",
            VpcId: "vpc-12345678",
            OwnerId: session.accountId,
            IpPermissions: [],
          },
        ],
      });
    ec2.on(RunInstancesCommand).rejects({ name: "DryRunOperation" });
    try {
      const r = await preflight(session, ec2Config, review.tags, "plan-id");
      expect(r.imageId).toBe("ami-approved");
      expect(r.vcpu).toBe(2);
      expect(r.estimatedMonthlyUsd).toBeNull();
      expect(
        ec2.commandCalls(RunInstancesCommand)[0].args[0].input.DryRun,
      ).toBe(true);
      expect(
        ec2.commandCalls(DescribeImagesCommand)[0].args[0].input.Owners,
      ).toEqual(["amazon"]);
    } finally {
      pricing.restore();
    }
  });
});
