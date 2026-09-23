/**
 * Answers AWS SDK commands from the synthetic fixture world (AWS_MODE=fixtures only).
 * Outputs mirror real SDK output shapes, including pagination tokens and AWS-style errors,
 * so the production adapter code paths are exercised unchanged.
 */
import { EXTERNAL_ID_PATTERN } from "../../security/crypto";
import { daysAgo, seededRandom, WORLDS, type FxWorld } from "./world";

type Input = Record<string, unknown>;
interface Ctx {
  world: FxWorld;
  accountId: string;
  region: string;
  input: Input;
}
type Handler = (ctx: Ctx) => unknown;

export function awsError(code: string, status: number, message = code): Error {
  return Object.assign(new Error(message), { name: code, $metadata: { httpStatusCode: status }, $fault: status >= 500 ? "server" : "client" });
}

const tags = (t?: Record<string, string>) => Object.entries(t ?? {}).map(([Key, Value]) => ({ Key, Value }));
const inRegion = <T extends { region: string }>(items: T[], region: string) => items.filter((i) => i.region === region);

/** Slices `items` into pages; tokens are opaque "fx:<offset>" strings. */
function page<T>(items: T[], token: unknown, size: number): { items: T[]; next?: string } {
  const offset = typeof token === "string" && token.startsWith("fx:") ? Number(token.slice(3)) : 0;
  const slice = items.slice(offset, offset + size);
  const next = offset + size < items.length ? `fx:${offset + size}` : undefined;
  return { items: slice, next };
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// ─────────────────────────── STS ───────────────────────────
const sts: Record<string, Handler> = {
  AssumeRole: ({ input }) => {
    const arn = str(input.RoleArn) ?? "";
    const m = /^arn:aws:iam::(\d{12}):role\/(?:.*\/)?([\w+=,.@-]+)$/.exec(arn);
    const externalId = str(input.ExternalId) ?? "";
    if (!m || !WORLDS[m[1]!] || !m[2]!.startsWith("Stratus") || m[2]!.includes("Deleted") || !EXTERNAL_ID_PATTERN.test(externalId)) {
      throw awsError("AccessDenied", 403, "User is not authorized to perform: sts:AssumeRole");
    }
    const session = str(input.RoleSessionName) ?? "fixture";
    return {
      Credentials: {
        AccessKeyId: "ASIAFIXTUREFIXTURE00",
        SecretAccessKey: "fixture/secret/access/key/not/real/000000",
        SessionToken: "fixture-session-token-not-real",
        Expiration: new Date(Date.now() + 3600_000),
      },
      AssumedRoleUser: { Arn: `arn:aws:sts::${m[1]}:assumed-role/${m[2]}/${session}`, AssumedRoleId: "AROAFIXTURE:session" },
    };
  },
  GetCallerIdentity: ({ accountId }) => ({
    Account: accountId,
    Arn: `arn:aws:sts::${accountId}:assumed-role/StratusReadOnlyRole/fixture`,
    UserId: "AROAFIXTURE:fixture",
  }),
};

// ─────────────────────────── EC2 / VPC ───────────────────────────
function assertRegionHealthy({ world, region }: Ctx) {
  const code = world.failingRegions?.[region];
  if (code) throw awsError(code, 503, "Service is unavailable in this region");
}

const ec2: Record<string, Handler> = {
  DescribeRegions: ({ world }) => ({ Regions: world.regions.map((RegionName) => ({ RegionName, OptInStatus: "opt-in-not-required", Endpoint: `ec2.${RegionName}.amazonaws.com` })) }),
  DescribeInstances: (ctx) => {
    assertRegionHealthy(ctx);
    const all = inRegion(ctx.world.instances, ctx.region);
    const size = Math.min(Number(ctx.input.MaxResults ?? 3), 3);
    const { items, next } = page(all, ctx.input.NextToken, size);
    return {
      Reservations: items.map((i) => ({
        ReservationId: `r-${i.id.slice(2)}`,
        Instances: [
          {
            InstanceId: i.id,
            InstanceType: i.type,
            Architecture: i.arch,
            State: { Name: i.state, Code: i.state === "running" ? 16 : 80 },
            StateTransitionReason: i.state === "stopped" ? `User initiated (${daysAgo(i.stoppedDaysAgo ?? 1).toISOString().slice(0, 19).replace("T", " ")} GMT)` : "",
            Placement: { AvailabilityZone: i.az },
            PublicIpAddress: i.publicIp,
            PrivateIpAddress: i.privateIp,
            VpcId: i.vpcId,
            SubnetId: i.subnetId,
            SecurityGroups: i.sgIds.map((GroupId) => ({ GroupId, GroupName: ctx.world.securityGroups.find((s) => s.id === GroupId)?.name })),
            IamInstanceProfile: i.profile ? { Arn: `arn:aws:iam::${ctx.accountId}:instance-profile/${i.profile}`, Id: "AIPAFIXTURE" } : undefined,
            LaunchTime: daysAgo(i.launchedDaysAgo),
            PlatformDetails: "Linux/UNIX",
            Monitoring: { State: "disabled" },
            BlockDeviceMappings: i.volumeIds.map((VolumeId, idx) => ({ DeviceName: idx === 0 ? "/dev/xvda" : `/dev/sd${String.fromCharCode(98 + idx)}`, Ebs: { VolumeId, Status: "attached", DeleteOnTermination: true } })),
            // Hazard: user data is never requested (DescribeInstanceAttribute is denied in the role).
            Tags: [{ Key: "Name", Value: i.name }, ...tags(i.tags)],
          },
        ],
      })),
      NextToken: next,
    };
  },
  DescribeVolumes: (ctx) => {
    assertRegionHealthy(ctx);
    const { items, next } = page(inRegion(ctx.world.volumes, ctx.region), ctx.input.NextToken, 5);
    return {
      Volumes: items.map((v) => ({
        VolumeId: v.id,
        Size: v.sizeGiB,
        VolumeType: v.type,
        Encrypted: v.encrypted,
        State: v.attachedTo ? "in-use" : "available",
        AvailabilityZone: v.az,
        CreateTime: daysAgo(v.createdDaysAgo),
        Attachments: v.attachedTo ? [{ InstanceId: v.attachedTo, State: "attached", VolumeId: v.id }] : [],
      })),
      NextToken: next,
    };
  },
  DescribeSnapshots: (ctx) => {
    assertRegionHealthy(ctx);
    return {
      Snapshots: inRegion(ctx.world.snapshots, ctx.region).map((s) => ({
        SnapshotId: s.id,
        VolumeId: s.volumeId,
        VolumeSize: s.sizeGiB,
        StartTime: daysAgo(s.createdDaysAgo),
        Encrypted: s.encrypted,
        State: "completed",
        OwnerId: ctx.accountId,
      })),
    };
  },
  DescribeAddresses: (ctx) => ({
    Addresses: inRegion(ctx.world.addresses, ctx.region).map((a) => ({
      AllocationId: a.allocationId,
      PublicIp: a.publicIp,
      InstanceId: a.instanceId,
      AssociationId: a.instanceId ? `eipassoc-${a.allocationId.slice(9)}` : undefined,
      Domain: "vpc",
    })),
  }),
  DescribeVpcs: (ctx) => ({
    Vpcs: inRegion(ctx.world.vpcs, ctx.region).map((v) => ({ VpcId: v.id, CidrBlock: v.cidr, IsDefault: v.isDefault, State: "available", Tags: [{ Key: "Name", Value: v.name }] })),
  }),
  DescribeSubnets: (ctx) => ({
    Subnets: inRegion(ctx.world.subnets, ctx.region).map((s) => ({
      SubnetId: s.id,
      VpcId: s.vpcId,
      AvailabilityZone: s.az,
      CidrBlock: s.cidr,
      MapPublicIpOnLaunch: s.public,
      AvailableIpAddressCount: 200,
      Tags: [{ Key: "Name", Value: s.name }],
    })),
  }),
  DescribeInternetGateways: (ctx) => ({
    InternetGateways: inRegion(ctx.world.igws, ctx.region).map((g) => ({ InternetGatewayId: g.id, Attachments: [{ VpcId: g.vpcId, State: "available" }] })),
  }),
  DescribeNatGateways: (ctx) => ({
    NatGateways: inRegion(ctx.world.nats, ctx.region).map((n) => ({ NatGatewayId: n.id, VpcId: n.vpcId, SubnetId: n.subnetId, State: "available", NatGatewayAddresses: [{ PublicIp: n.publicIp }] })),
  }),
  DescribeRouteTables: (ctx) => ({
    RouteTables: inRegion(ctx.world.routeTables, ctx.region).map((r) => ({
      RouteTableId: r.id,
      VpcId: r.vpcId,
      Associations: [...r.subnetIds.map((SubnetId) => ({ SubnetId, Main: false })), ...(r.main ? [{ Main: true }] : [])],
      Routes: r.routes.map((x) => ({
        DestinationCidrBlock: x.dest,
        State: "active",
        ...(x.target === "local" ? { GatewayId: "local" } : x.target.startsWith("igw-") ? { GatewayId: x.target } : { NatGatewayId: x.target }),
      })),
    })),
  }),
  DescribeSecurityGroups: (ctx) => ({
    SecurityGroups: inRegion(ctx.world.securityGroups, ctx.region).map((g) => ({
      GroupId: g.id,
      GroupName: g.name,
      VpcId: g.vpcId,
      Description: `${g.name} (fixture)`,
      IpPermissions: g.ingress.map((r) => ({
        IpProtocol: r.proto,
        FromPort: r.proto === "-1" ? undefined : r.from,
        ToPort: r.proto === "-1" ? undefined : r.to,
        IpRanges: r.cidr ? [{ CidrIp: r.cidr }] : [],
        Ipv6Ranges: r.ipv6 ? [{ CidrIpv6: r.ipv6 }] : [],
        UserIdGroupPairs: r.sg ? [{ GroupId: r.sg }] : [],
      })),
      IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
    })),
  }),
  DescribeNetworkAcls: (ctx) => ({
    NetworkAcls: inRegion(ctx.world.nacls, ctx.region).map((n) => ({
      NetworkAclId: n.id,
      VpcId: n.vpcId,
      IsDefault: n.isDefault,
      Associations: n.subnetIds.map((SubnetId) => ({ SubnetId })),
      Entries: [{ RuleNumber: 100, Protocol: "-1", RuleAction: "allow", Egress: false, CidrBlock: "0.0.0.0/0" }],
    })),
  }),
  DescribeVpcEndpoints: (ctx) => ({
    VpcEndpoints: inRegion(ctx.world.vpcEndpoints, ctx.region).map((e) => ({ VpcEndpointId: e.id, VpcId: e.vpcId, ServiceName: e.service, VpcEndpointType: e.type, State: "available" })),
  }),
  CreateTags: () => ({ return: true }),
  DeleteTags: () => ({ return: true }),
  StartInstances: ({ input }) => ({
    StartingInstances: ((input.InstanceIds as string[]) ?? []).map((id) => ({
      InstanceId: id,
      CurrentState: { Name: "pending", Code: 0 },
      PreviousState: { Name: "stopped", Code: 80 },
    })),
  }),
  StopInstances: ({ input }) => ({
    StoppingInstances: ((input.InstanceIds as string[]) ?? []).map((id) => ({
      InstanceId: id,
      CurrentState: { Name: "stopping", Code: 64 },
      PreviousState: { Name: "running", Code: 16 },
    })),
  }),
  RebootInstances: () => ({ return: true }),
  TerminateInstances: ({ input }) => ({
    TerminatingInstances: ((input.InstanceIds as string[]) ?? []).map((id) => ({
      InstanceId: id,
      CurrentState: { Name: "shutting-down", Code: 32 },
      PreviousState: { Name: "running", Code: 16 },
    })),
  }),
  ModifyInstanceAttribute: () => ({ return: true }),
  MonitorInstances: ({ input }) => ({
    InstanceMonitorings: ((input.InstanceIds as string[]) ?? []).map((id) => ({
      InstanceId: id,
      Monitoring: { State: "enabled" },
    })),
  }),
  UnmonitorInstances: ({ input }) => ({
    InstanceMonitorings: ((input.InstanceIds as string[]) ?? []).map((id) => ({
      InstanceId: id,
      Monitoring: { State: "disabled" },
    })),
  }),
};

// ─────────────────────────── S3 ───────────────────────────
function bucket(world: FxWorld, input: Input) {
  const b = world.buckets.find((x) => x.name === input.Bucket);
  if (!b) throw awsError("NoSuchBucket", 404);
  return b;
}

const s3: Record<string, Handler> = {
  ListBuckets: ({ world, input }) => {
    const { items, next } = page(world.buckets, input.ContinuationToken, 3);
    return {
      Buckets: items.map((b) => ({ Name: b.name, CreationDate: daysAgo(b.createdDaysAgo), BucketRegion: b.region })),
      ContinuationToken: next,
      Owner: { ID: "fixture-owner" },
    };
  },
  GetBucketLocation: ({ world, input }) => {
    const b = bucket(world, input);
    return { LocationConstraint: b.region === "us-east-1" ? undefined : b.region };
  },
  GetBucketEncryption: ({ world, input }) => {
    const b = bucket(world, input);
    return {
      ServerSideEncryptionConfiguration: {
        Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: b.sse, KMSMasterKeyID: b.sse === "aws:kms" ? "alias/fixture" : undefined }, BucketKeyEnabled: b.sse === "aws:kms" }],
      },
    };
  },
  GetBucketVersioning: ({ world, input }) => ({ Status: bucket(world, input).versioning ?? undefined }),
  GetPublicAccessBlock: ({ world, input }) => {
    const b = bucket(world, input);
    if (!b.pab) throw awsError("NoSuchPublicAccessBlockConfiguration", 404);
    return { PublicAccessBlockConfiguration: b.pab };
  },
  GetBucketPolicyStatus: ({ world, input }) => {
    const b = bucket(world, input);
    if (b.policyPublic === null) throw awsError("NoSuchBucketPolicy", 404);
    return { PolicyStatus: { IsPublic: b.policyPublic } };
  },
  GetBucketAcl: ({ world, input }) => {
    const b = bucket(world, input);
    return {
      Owner: { ID: "fixture-owner" },
      Grants: [
        { Grantee: { Type: "CanonicalUser", ID: "fixture-owner" }, Permission: "FULL_CONTROL" },
        ...(b.aclAllUsers ? [{ Grantee: { Type: "Group", URI: "http://acs.amazonaws.com/groups/global/AllUsers" }, Permission: "READ" }] : []),
      ],
    };
  },
  GetBucketLogging: ({ world, input }) => {
    const b = bucket(world, input);
    return b.logging ? { LoggingEnabled: { TargetBucket: "acme-access-logs", TargetPrefix: `${b.name}/` } } : {};
  },
  GetBucketLifecycleConfiguration: ({ world, input }) => {
    const b = bucket(world, input);
    if (!b.lifecycle) throw awsError("NoSuchLifecycleConfiguration", 404);
    return { Rules: [{ ID: "expire-noncurrent", Status: "Enabled", NoncurrentVersionExpiration: { NoncurrentDays: 30 } }] };
  },
  GetBucketTagging: ({ world, input }) => {
    const b = bucket(world, input);
    if (!b.tags) throw awsError("NoSuchTagSet", 404);
    return { TagSet: tags(b.tags) };
  },
  PutBucketTagging: () => ({}),
  DeleteBucketTagging: () => ({}),
  PutBucketVersioning: () => ({}),
  PutBucketEncryption: () => ({}),
  PutPublicAccessBlock: () => ({}),
};

const s3control: Record<string, Handler> = {
  GetPublicAccessBlock: ({ world }) => {
    if (!world.accountPab) throw awsError("NoSuchPublicAccessBlockConfiguration", 404);
    return { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
  },
};

// ─────────────────────────── Databases ───────────────────────────
const rds: Record<string, Handler> = {
  DescribeDBInstances: ({ world, region, accountId }) => ({
    DBInstances: inRegion(world.rds, region).map((d) => ({
      DBInstanceIdentifier: d.id,
      DBInstanceArn: `arn:aws:rds:${region}:${accountId}:db:${d.id}`,
      Engine: d.engine,
      EngineVersion: d.version,
      DBInstanceClass: d.cls,
      DBInstanceStatus: d.status,
      AllocatedStorage: d.storageGiB,
      StorageEncrypted: d.encrypted,
      PubliclyAccessible: d.public,
      MultiAZ: d.multiAz,
      BackupRetentionPeriod: d.backupDays,
      DBClusterIdentifier: d.clusterId,
      AvailabilityZone: `${region}a`,
      Endpoint: { Address: `${d.id}.fixture.${region}.rds.amazonaws.com`, Port: d.engine.includes("mysql") ? 3306 : 5432 },
      DBSubnetGroup: { VpcId: d.vpcId, Subnets: d.subnetIds.map((SubnetIdentifier) => ({ SubnetIdentifier })) },
      InstanceCreateTime: daysAgo(300),
      // Hazard: MasterUsername is returned by AWS but must not be stored.
      MasterUsername: "fixture_admin",
      TagList: [{ Key: "env", Value: "prod" }],
    })),
  }),
  DescribeDBClusters: ({ world, region, accountId }) => ({
    DBClusters: inRegion(world.rdsClusters, region).map((c) => ({
      DBClusterIdentifier: c.id,
      DBClusterArn: `arn:aws:rds:${region}:${accountId}:cluster:${c.id}`,
      Engine: c.engine,
      EngineVersion: c.version,
      Status: c.status,
      StorageEncrypted: c.encrypted,
      EngineMode: c.serverless ? "serverless" : "provisioned",
      DBClusterMembers: c.members.map((DBInstanceIdentifier) => ({ DBInstanceIdentifier, IsClusterWriter: true })),
      TagList: [],
    })),
  }),
  AddTagsToResource: () => ({}),
  RemoveTagsFromResource: () => ({}),
};

const dynamodb: Record<string, Handler> = {
  ListTables: ({ world, region }) => ({ TableNames: inRegion(world.dynamo, region).map((t) => t.name) }),
  DescribeTable: ({ world, region, accountId, input }) => {
    const t = inRegion(world.dynamo, region).find((x) => x.name === input.TableName);
    if (!t) throw awsError("ResourceNotFoundException", 400);
    return {
      Table: {
        TableName: t.name,
        TableArn: `arn:aws:dynamodb:${region}:${accountId}:table/${t.name}`,
        TableStatus: "ACTIVE",
        ItemCount: t.items,
        TableSizeBytes: t.sizeBytes,
        BillingModeSummary: { BillingMode: t.billing },
        ProvisionedThroughput: { ReadCapacityUnits: t.rcu ?? 0, WriteCapacityUnits: t.wcu ?? 0 },
        SSEDescription: t.sse === "KMS" ? { Status: "ENABLED", SSEType: "KMS" } : undefined,
        CreationDateTime: daysAgo(400),
      },
    };
  },
  DescribeContinuousBackups: ({ world, region, input }) => {
    const t = inRegion(world.dynamo, region).find((x) => x.name === input.TableName);
    return { ContinuousBackupsDescription: { ContinuousBackupsStatus: "ENABLED", PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: t?.pitr ? "ENABLED" : "DISABLED" } } };
  },
  TagResource: () => ({}),
  UntagResource: () => ({}),
};

// ─────────────────────────── Serverless / containers ───────────────────────────
const lambda: Record<string, Handler> = {
  ListFunctions: ({ world, region, accountId, input }) => {
    const { items, next } = page(inRegion(world.lambdas, region), input.Marker, 2);
    return {
      Functions: items.map((f) => ({
        FunctionName: f.name,
        FunctionArn: `arn:aws:lambda:${region}:${accountId}:function:${f.name}`,
        Runtime: f.runtime,
        MemorySize: f.memory,
        Timeout: f.timeout,
        Architectures: [f.arch],
        LastModified: daysAgo(f.modifiedDaysAgo).toISOString().replace("Z", "+0000"),
        VpcConfig: f.vpcId ? { VpcId: f.vpcId, SubnetIds: ["subnet-0prv0001a"], SecurityGroupIds: ["sg-0api00001"] } : undefined,
        Layers: Array.from({ length: f.layers }, (_, i) => ({ Arn: `arn:aws:lambda:${region}:${accountId}:layer:shared-${i}:3`, CodeSize: 1000 })),
        // Hazard: AWS returns environment variables here. The normaliser must drop them.
        Environment: f.env ? { Variables: f.env } : undefined,
        Handler: "index.handler",
        CodeSize: 123_456,
        PackageType: "Zip",
      })),
      NextMarker: next,
    };
  },
  ListTags: ({ world, input }) => {
    const name = String(input.Resource ?? "").split(":").pop();
    return { Tags: world.lambdas.find((f) => f.name === name)?.tags ?? {} };
  },
  TagResource: () => ({}),
  UntagResource: () => ({}),
};

const ecs: Record<string, Handler> = {
  ListClusters: ({ world, region, accountId }) => ({ clusterArns: inRegion(world.ecsClusters, region).map((c) => `arn:aws:ecs:${region}:${accountId}:cluster/${c.name}`) }),
  DescribeClusters: ({ world, region, input }) => ({
    clusters: ((input.clusters as string[]) ?? []).map((arn) => {
      const c = inRegion(world.ecsClusters, region).find((x) => arn.endsWith(`/${x.name}`));
      return {
        clusterArn: arn,
        clusterName: c?.name,
        status: "ACTIVE",
        runningTasksCount: c?.services.reduce((s, x) => s + x.running, 0) ?? 0,
        pendingTasksCount: 0,
        activeServicesCount: c?.services.length ?? 0,
        registeredContainerInstancesCount: 0,
      };
    }),
  }),
  ListServices: ({ world, region, accountId, input }) => {
    const c = inRegion(world.ecsClusters, region).find((x) => String(input.cluster).endsWith(`/${x.name}`));
    return { serviceArns: (c?.services ?? []).map((s) => `arn:aws:ecs:${region}:${accountId}:service/${c?.name}/${s.name}`) };
  },
  DescribeServices: ({ world, region, input }) => {
    const c = inRegion(world.ecsClusters, region).find((x) => String(input.cluster).endsWith(`/${x.name}`));
    return {
      services: ((input.services as string[]) ?? []).map((arn) => {
        const s = c?.services.find((x) => arn.endsWith(`/${x.name}`));
        return { serviceArn: arn, serviceName: s?.name, status: "ACTIVE", desiredCount: s?.desired ?? 0, runningCount: s?.running ?? 0, launchType: s?.launchType, clusterArn: input.cluster };
      }),
    };
  },
  ListTasks: ({ world, region, input }) => {
    const c = inRegion(world.ecsClusters, region).find((x) => String(input.cluster).endsWith(`/${x.name}`));
    const n = c?.services.reduce((s, x) => s + x.running, 0) ?? 0;
    return { taskArns: Array.from({ length: n }, (_, i) => `arn:aws:ecs:${region}:task/${c?.name}/${i}`) };
  },
};

const eks: Record<string, Handler> = {
  ListClusters: ({ world, region }) => ({ clusters: inRegion(world.eksClusters, region).map((c) => c.name) }),
  DescribeCluster: ({ world, region, accountId, input }) => {
    const c = inRegion(world.eksClusters, region).find((x) => x.name === input.name);
    if (!c) throw awsError("ResourceNotFoundException", 404);
    return {
      cluster: {
        name: c.name,
        arn: `arn:aws:eks:${region}:${accountId}:cluster/${c.name}`,
        version: c.version,
        status: c.status,
        endpoint: `https://FIXTURE.gr7.${region}.eks.amazonaws.com`,
        platformVersion: "eks.12",
        createdAt: daysAgo(250),
        resourcesVpcConfig: { vpcId: "vpc-0prod0001", subnetIds: ["subnet-0prv0001a", "subnet-0prv0001b"], endpointPublicAccess: c.publicAccess, endpointPrivateAccess: c.privateAccess, publicAccessCidrs: c.publicCidrs },
        tags: { env: "prod" },
      },
    };
  },
};

const ecr: Record<string, Handler> = {
  DescribeRepositories: ({ world, region, accountId }) => ({
    repositories: inRegion(world.ecrRepos, region).map((r) => ({
      repositoryName: r.name,
      repositoryArn: `arn:aws:ecr:${region}:${accountId}:repository/${r.name}`,
      repositoryUri: `${accountId}.dkr.ecr.${region}.amazonaws.com/${r.name}`,
      createdAt: daysAgo(365),
      imageTagMutability: r.mutable ? "MUTABLE" : "IMMUTABLE",
      imageScanningConfiguration: { scanOnPush: r.scanOnPush },
      encryptionConfiguration: { encryptionType: "AES256" },
    })),
  }),
  DescribeImages: ({ world, region, input }) => {
    const r = inRegion(world.ecrRepos, region).find((x) => x.name === input.repositoryName);
    const all = Array.from({ length: r?.images ?? 0 }, (_, i) => i);
    const { items, next } = page(all, input.nextToken, 20);
    return {
      imageDetails: items.map((i) => ({
        imageDigest: `sha256:${String(i).padStart(64, "0")}`,
        imageTags: i === 0 ? ["latest"] : [`v${i}`],
        imagePushedAt: daysAgo(i),
        imageSizeInBytes: 50_000_000,
        imageScanFindingsSummary: i === 0 && r?.scanOnPush !== undefined ? { findingSeverityCounts: { CRITICAL: r.critical, HIGH: r.high } } : undefined,
      })),
      nextToken: next,
    };
  },
};

const elbv2: Record<string, Handler> = {
  DescribeLoadBalancers: ({ world, region, accountId }) => ({
    LoadBalancers: inRegion(world.loadBalancers, region).map((l) => ({
      LoadBalancerArn: `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/${l.type === "application" ? "app" : "net"}/${l.name}/fixture`,
      LoadBalancerName: l.name,
      DNSName: l.dns,
      Scheme: l.scheme,
      Type: l.type,
      VpcId: l.vpcId,
      State: { Code: "active" },
      AvailabilityZones: l.subnetIds.map((SubnetId, i) => ({ SubnetId, ZoneName: `${region}${"ab"[i] ?? "a"}` })),
      SecurityGroups: l.sgIds,
      CreatedTime: daysAgo(200),
    })),
  }),
  DescribeTags: ({ input }) => ({ TagDescriptions: ((input.ResourceArns as string[]) ?? []).map((ResourceArn) => ({ ResourceArn, Tags: [{ Key: "env", Value: "prod" }] })) }),
};

// ─────────────────────────── Global services ───────────────────────────
const cloudfront: Record<string, Handler> = {
  ListDistributions: ({ world, accountId }) => ({
    DistributionList: {
      Quantity: world.cloudfront.length,
      IsTruncated: false,
      Items: world.cloudfront.map((d) => ({ Id: d.id, ARN: `arn:aws:cloudfront::${accountId}:distribution/${d.id}`, DomainName: d.domain, Enabled: d.enabled, Status: "Deployed", Aliases: { Quantity: d.aliases.length, Items: d.aliases }, Comment: "fixture" })),
    },
  }),
};
const route53: Record<string, Handler> = {
  ListHostedZones: ({ world }) => ({ IsTruncated: false, HostedZones: world.hostedZones.map((z) => ({ Id: z.id, Name: z.name, Config: { PrivateZone: z.private }, ResourceRecordSetCount: z.records })) }),
};
const apigateway: Record<string, Handler> = {
  GetRestApis: ({ world, region }) => ({ items: inRegion(world.restApis, region).map((a) => ({ id: a.id, name: a.name, createdDate: daysAgo(100), endpointConfiguration: { types: ["REGIONAL"] } })) }),
};
const apigatewayv2: Record<string, Handler> = {
  GetApis: ({ world, region }) => ({ Items: inRegion(world.httpApis, region).map((a) => ({ ApiId: a.id, Name: a.name, ProtocolType: "HTTP", ApiEndpoint: `https://${a.id}.execute-api.${region}.amazonaws.com`, CreatedDate: daysAgo(50) })) }),
};
const sns: Record<string, Handler> = {
  ListTopics: ({ world, region, accountId }) => ({ Topics: inRegion(world.topics, region).map((t) => ({ TopicArn: `arn:aws:sns:${region}:${accountId}:${t.name}` })) }),
};
const sqs: Record<string, Handler> = {
  ListQueues: ({ world, region, accountId }) => ({ QueueUrls: inRegion(world.queues, region).map((q) => `https://sqs.${region}.amazonaws.com/${accountId}/${q.name}`) }),
  GetQueueAttributes: ({ world, input }) => {
    const q = world.queues.find((x) => String(input.QueueUrl).endsWith(`/${x.name}`));
    return { Attributes: { SqsManagedSseEnabled: String(Boolean(q?.encrypted)), ApproximateNumberOfMessages: "3" } };
  },
};
const iam: Record<string, Handler> = {
  GetAccountSummary: ({ world }) => ({ SummaryMap: { AccountMFAEnabled: world.iam.mfaRoot ? 1 : 0, AccountAccessKeysPresent: world.iam.rootKeys ? 1 : 0, Users: world.iam.users.length } }),
  GetAccountPasswordPolicy: ({ world }) => {
    if (!world.iam.passwordPolicy) throw awsError("NoSuchEntity", 404);
    return { PasswordPolicy: { MinimumPasswordLength: 14, RequireSymbols: true } };
  },
  ListUsers: ({ world, accountId }) => ({ IsTruncated: false, Users: world.iam.users.map((u) => ({ UserName: u.name, UserId: `AIDAFIXTURE${u.name.length}`, Arn: `arn:aws:iam::${accountId}:user/${u.name}`, CreateDate: daysAgo(800) })) }),
  ListAccessKeys: ({ world, input }) => ({
    IsTruncated: false,
    AccessKeyMetadata: (world.iam.users.find((u) => u.name === input.UserName)?.keys ?? []).map((k) => ({ UserName: input.UserName, AccessKeyId: k.id, Status: k.active ? "Active" : "Inactive", CreateDate: daysAgo(k.ageDays) })),
  }),
};

// ─────────────────────────── CloudWatch ───────────────────────────
const METRIC_SHAPE: Record<string, { base: number; spread: number }> = {
  NetworkIn: { base: 4_000_000, spread: 3_000_000 },
  NetworkOut: { base: 6_000_000, spread: 4_000_000 },
  DiskReadBytes: { base: 200_000, spread: 150_000 },
  DiskWriteBytes: { base: 350_000, spread: 250_000 },
  StatusCheckFailed: { base: 0, spread: 0 },
  Invocations: { base: 1200, spread: 900 },
  Errors: { base: 4, spread: 6 },
  Duration: { base: 180, spread: 120 },
  Throttles: { base: 0, spread: 1 },
};

const cloudwatch: Record<string, Handler> = {
  ListMetrics: () => ({ Metrics: [] }),
  GetMetricData: ({ world, input }) => {
    const start = new Date(input.StartTime as string | Date).getTime();
    const end = new Date(input.EndTime as string | Date).getTime();
    const queries = (input.MetricDataQueries as { Id: string; MetricStat?: { Metric?: { MetricName?: string; Dimensions?: { Name: string; Value: string }[] }; Period?: number } }[]) ?? [];
    return {
      MetricDataResults: queries.map((q) => {
        const metric = q.MetricStat?.Metric?.MetricName ?? "";
        const dim = q.MetricStat?.Metric?.Dimensions?.[0]?.Value ?? "";
        const period = (q.MetricStat?.Period ?? 300) * 1000;
        const inst = world.instances.find((i) => i.id === dim);
        const fn = world.lambdas.find((f) => f.name === dim);
        // Stopped instances / unknown resources have no datapoints (graceful "no data" path).
        if ((!inst && !fn) || inst?.state === "stopped") return { Id: q.Id, Label: metric, Timestamps: [], Values: [], StatusCode: "Complete" };
        const rnd = seededRandom(`${dim}:${metric}`);
        const shape = metric === "CPUUtilization" ? { base: inst?.cpuAvg ?? 10, spread: Math.max(1, (inst?.cpuAvg ?? 10) * 0.4) } : (METRIC_SHAPE[metric] ?? { base: 1, spread: 1 });
        const ts: Date[] = [];
        const vals: number[] = [];
        const count = Math.min(1440, Math.floor((end - start) / period));
        for (let i = count - 1; i >= 0; i--) {
          const t = end - i * period;
          const daily = Math.sin((t / 86_400_000) * Math.PI * 2) * 0.25;
          ts.push(new Date(t));
          vals.push(Math.max(0, shape.base * (1 + daily) + (rnd() - 0.5) * shape.spread));
        }
        return { Id: q.Id, Label: metric, Timestamps: ts.reverse(), Values: vals.reverse(), StatusCode: "Complete" };
      }),
    };
  },
};

// ─────────────────────────── Cost Explorer ───────────────────────────
function dailyCost(world: FxWorld, accountId: string, day: Date): number {
  if (world.cost === "denied") return 0;
  const rnd = seededRandom(`${accountId}:${day.toISOString().slice(0, 10)}`);
  const dow = day.getUTCDay();
  const weekly = dow === 0 || dow === 6 ? -0.12 : 0.04;
  const ageDays = (Date.now() - day.getTime()) / 86_400_000;
  const trend = -ageDays * 0.0006; // slow growth towards today
  return world.cost.baseDaily * Math.max(0.3, 1 + weekly + trend + (rnd() - 0.5) * 0.1);
}

const ce: Record<string, Handler> = {
  GetCostAndUsage: ({ world, accountId, input }) => {
    if (world.cost === "denied") throw awsError("AccessDeniedException", 400, "User is not authorized to perform ce:GetCostAndUsage");
    const cost = world.cost;
    const tp = input.TimePeriod as { Start: string; End: string };
    const granularity = input.Granularity as "DAILY" | "MONTHLY";
    const groupKey = (input.GroupBy as { Key: string }[] | undefined)?.[0]?.Key;
    const start = new Date(`${tp.Start}T00:00:00Z`);
    const end = new Date(`${tp.End}T00:00:00Z`);
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const periods: { s: Date; e: Date }[] = [];
    if (granularity === "DAILY") {
      for (let d = new Date(start); d < end && d < today; d = new Date(d.getTime() + 86_400_000)) periods.push({ s: d, e: new Date(d.getTime() + 86_400_000) });
    } else {
      for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        periods.push({ s: d < start ? start : d, e: new Date(Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), end.getTime())) });
      }
    }
    const { items, next } = page(periods, input.NextPageToken, 90);
    const shares: [string, number][] =
      groupKey === "SERVICE" ? cost.services : groupKey === "REGION" ? cost.regions : groupKey === "LINKED_ACCOUNT" ? [[accountId, 1]] : [];
    const fmt = (n: number) => ({ Amount: n.toFixed(6), Unit: "USD" });
    return {
      ResultsByTime: items.map(({ s, e }) => {
        let total = 0;
        for (let d = new Date(s); d < e && d < today; d = new Date(d.getTime() + 86_400_000)) total += dailyCost(world, accountId, d);
        return {
          TimePeriod: { Start: s.toISOString().slice(0, 10), End: e.toISOString().slice(0, 10) },
          Estimated: e > monthStart,
          Total: groupKey ? {} : { UnblendedCost: fmt(total) },
          Groups: shares.map(([k, share]) => ({ Keys: [k], Metrics: { UnblendedCost: fmt(total * share) } })),
        };
      }),
      NextPageToken: next,
      DimensionValueAttributes: [],
    };
  },
};

// ─────────────────────────── Security services ───────────────────────────
const cloudtrail: Record<string, Handler> = {
  DescribeTrails: ({ world, accountId }) => ({
    trailList: world.trails.map((t) => ({ Name: t.name, TrailARN: `arn:aws:cloudtrail:${t.homeRegion}:${accountId}:trail/${t.name}`, HomeRegion: t.homeRegion, IsMultiRegionTrail: t.multiRegion, LogFileValidationEnabled: true })),
  }),
  GetTrailStatus: ({ world, input }) => ({ IsLogging: world.trails.find((t) => String(input.Name).endsWith(t.name))?.logging ?? false }),
};

const guardduty: Record<string, Handler> = {
  GetDetector: () => ({ Status: "ENABLED" }),
  ListDetectors: ({ world, region }) => {
    const g = world.guardduty[region];
    return { DetectorIds: g === undefined || g === "disabled" ? [] : [`fixture-detector-${region}`] };
  },
  ListFindings: ({ world, region }) => {
    const g = world.guardduty[region];
    return { FindingIds: Array.isArray(g) ? g.map((f) => f.id) : [] };
  },
  GetFindings: ({ world, region }) => {
    const g = world.guardduty[region];
    return {
      Findings: (Array.isArray(g) ? g : []).map((f) => ({
        Id: f.id,
        Type: f.type,
        Severity: f.severity,
        Title: f.title,
        Description: `${f.title} (fixture)`,
        Region: region,
        Resource: { ResourceType: f.resourceType },
        CreatedAt: daysAgo(f.daysAgo).toISOString(),
        UpdatedAt: daysAgo(f.daysAgo).toISOString(),
      })),
    };
  },
};

const securityhub: Record<string, Handler> = {
  DescribeHub: ({ world, region }) => {
    const s = world.securityhub[region];
    if (s === undefined || s === "disabled") throw awsError("InvalidAccessException", 401, "Account is not subscribed to AWS Security Hub");
    return { HubArn: `arn:aws:securityhub:${region}:fixture:hub/default`, SubscribedAt: daysAgo(200).toISOString() };
  },
  GetFindings: ({ world, region }) => {
    const s = world.securityhub[region];
    if (s === undefined || s === "disabled") throw awsError("InvalidAccessException", 401);
    return {
      Findings: s.map((f) => ({
        Id: f.id,
        Title: f.title,
        Description: `${f.title} (fixture)`,
        Severity: { Label: f.severity },
        Resources: [{ Id: f.resourceId, Type: "AwsResource" }],
        Region: region,
        CreatedAt: daysAgo(f.daysAgo).toISOString(),
        UpdatedAt: daysAgo(f.daysAgo).toISOString(),
        Workflow: { Status: "NEW" },
        RecordState: "ACTIVE",
        Remediation: { Recommendation: { Text: "See AWS Security Hub control documentation." } },
      })),
    };
  },
};

const invoicing: Record<string, Handler> = {
  ListInvoiceSummaries: ({ accountId, world }) => {
    if (world.cost === "denied") throw awsError("AccessDeniedException", 403);
    const now = new Date();
    const issued = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2));
    const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { InvoiceSummaries: [{
      InvoiceId: `fixture-invoice-${accountId}-${period.toISOString().slice(0, 7)}`, AccountId: accountId,
      IssuedDate: issued, BillingPeriod: { Year: period.getUTCFullYear(), Month: period.getUTCMonth() + 1 },
      InvoiceType: "INVOICE", Entity: { InvoicingEntity: "AWS fixture billing entity" },
      PaymentCurrencyAmount: { CurrencyCode: accountId === "123456789012" ? "INR" : "EUR", TotalAmount: accountId === "123456789012" ? "123456.78" : "234.56" },
    }] };
  },
};

// ─────────────────────────── Price List (synthetic test prices) ───────────────────────────
const FX_EBS: Record<string, number> = { gp2: 0.1, gp3: 0.08, io1: 0.125, io2: 0.125, st1: 0.045, sc1: 0.015, standard: 0.05 };
const FX_EC2: Record<string, number> = { "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416, "t3.large": 0.0832, "t4g.small": 0.0168, "m6i.large": 0.096, "m6i.4xlarge": 0.768, "m5.large": 0.096, "r6g.large": 0.1008, "c6i.xlarge": 0.17 };
const priceDoc = (usd: number) => JSON.stringify({ terms: { OnDemand: { "X.JRTCKXETXF": { priceDimensions: { "X.JRTCKXETXF.6YS6EN2CT7": { pricePerUnit: { USD: String(usd) } } } } } } });
const pricing: Record<string, Handler> = {
  GetProducts: ({ input }) => {
    const f = Object.fromEntries(((input.Filters as { Field: string; Value: string }[]) ?? []).map((x) => [x.Field, x.Value]));
    let usd: number | undefined;
    if (f.productFamily === "Storage") usd = FX_EBS[f.volumeApiName ?? ""];
    else if (f.productFamily === "Storage Snapshot") usd = 0.05;
    else if (f.group === "VPCPublicIPv4Address") usd = 0.005;
    else if (f.instanceType) usd = FX_EC2[f.instanceType];
    return { PriceList: usd === undefined ? [] : [priceDoc(usd)], FormatVersion: "aws_v1" };
  },
};

const HANDLERS: Record<string, Record<string, Handler>> = {
  pricing,
  invoicing, sts, ec2, s3, s3control, rds, dynamodb, lambda, ecs, eks, ecr, elbv2, cloudfront, route53, apigateway, apigatewayv2, sns, sqs, iam, cloudwatch, ce, cloudtrail, guardduty, securityhub,
};

function matches(patterns: string[] | undefined, service: string, command: string): boolean {
  return (patterns ?? []).some((p) => {
    const [ps, pc] = p.split(":");
    return ps === service && (pc === "*" || pc === command);
  });
}

export async function resolveFixture(req: { service: string; command: string; region: string; accountId?: string; input: Input }): Promise<unknown> {
  const cmd = req.command.replace(/Command$/, "");
  const handler = HANDLERS[req.service]?.[cmd];
  if (!handler) throw awsError("UnknownOperationException", 400, `No fixture for ${req.service}:${cmd}`);

  // Platform-level calls (AssumeRole) have no customer account yet.
  if (req.service === "sts" && cmd === "AssumeRole") return handler({ world: WORLDS["123456789012"]!, accountId: "", region: req.region, input: req.input });

  const world = req.accountId ? WORLDS[req.accountId] : undefined;
  if (!world) throw awsError("AccessDenied", 403);
  const ctx: Ctx = { world, accountId: req.accountId!, region: req.region, input: req.input };
  if (!["sts", "s3", "s3control", "iam", "cloudfront", "route53", "ce", "invoicing", "pricing"].includes(req.service) && !world.regions.includes(req.region) && !(req.service === "ec2" && cmd === "DescribeRegions")) {
    throw awsError("AuthFailure", 401, "Region not enabled");
  }
  if (matches(world.denied, req.service, cmd)) throw awsError("AccessDeniedException", 403, "not authorized");
  if (matches(world.notEnabled, req.service, cmd)) throw awsError("InvalidAccessException", 401, "not subscribed");
  return handler(ctx);
}
