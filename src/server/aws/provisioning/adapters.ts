import "server-only";
import {
  EC2Client,
  DescribeVolumesCommand,
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeInstancesCommand,
  RunInstancesCommand,
  type RunInstancesRequest,
} from "@aws-sdk/client-ec2";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutBucketTaggingCommand,
  GetPublicAccessBlockCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketTaggingCommand,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";
import type { S3BucketAttrs } from "@/lib/resource-types";
import type { Configuration, Review } from "@/lib/provisioning";
import type { AwsSession } from "@/server/aws/session";
import { normalizeInstance } from "@/server/aws/collectors/ec2";
import type { NormalizedResource } from "@/server/aws/collectors/types";
import { loadPriceBook } from "@/server/aws/pricing";
import { reject, validateSecurityGroups } from "./safety";
import { createNetwork, locateNetwork, networkPreflight, verifyNetwork } from "./network";

// Creation clients deliberately disable automatic retries. Reads can be repeated safely.
const config = (s: AwsSession, region: string, mutation = false) => ({
  region,
  credentials: s.credentialProvider,
  maxAttempts: mutation ? 1 : 3,
  retryMode: "standard" as const,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 20000 },
});
export function runInput(
  c: Extract<Configuration, { service: "ec2" }>,
  review: Review,
  token: string,
): RunInstancesRequest {
  return {
    ImageId: review.imageId,
    InstanceType: c.instanceType,
    MinCount: 1,
    MaxCount: 1,
    ClientToken: token,
    KeyName: c.keyName,
    MetadataOptions: {
      HttpTokens: "required",
      HttpEndpoint: "enabled",
      HttpPutResponseHopLimit: 1,
    },
    NetworkInterfaces: [
      {
        DeviceIndex: 0,
        SubnetId: c.subnetId,
        Groups: c.securityGroupIds,
        AssociatePublicIpAddress: c.publicIpv4,
        DeleteOnTermination: true,
      },
    ],
    BlockDeviceMappings: [
      {
        DeviceName: review.rootDeviceName,
        Ebs: {
          VolumeSize: c.storageGiB,
          VolumeType: c.storageType,
          Encrypted: true,
          DeleteOnTermination: true,
        },
      },
    ],
    TagSpecifications: ["instance", "volume"].map((ResourceType) => ({
      ResourceType: ResourceType as "instance" | "volume",
      Tags: Object.entries(review.tags).map(([Key, Value]) => ({ Key, Value })),
    })),
  };
}
export async function preflight(
  session: AwsSession,
  c: Configuration,
  tags: Record<string, string>,
  token: string,
  pinned?: Review,
): Promise<Review> {
  const review: Review = {
    name: c.name,
    service: c.service,
    region: c.region,
    configuration: c,
    tags,
    estimatedMonthlyUsd: null,
    warnings: [],
    requiredPermissions: [],
    networkExposure: "Private",
  };
  if (c.service === "vpc" || c.service === "subnet") return networkPreflight(session, c, review);
  if (c.service === "s3") {
    const s3 = new S3Client(config(session, c.region));
    try {
      let absent = false;
      try {
        await s3.send(
          new HeadBucketCommand({
            Bucket: c.name,
            ExpectedBucketOwner: session.accountId,
          }),
        );
      } catch (e) {
        if (
          (e as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          absent = true;
        else throw e;
      }
      if (!absent) reject("That bucket already exists. Choose another name.");
    } finally {
      s3.destroy();
    }
    review.requiredPermissions = [
      "s3:CreateBucket",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutEncryptionConfiguration",
      "s3:PutBucketVersioning",
      "s3:PutBucketTagging",
    ];
    review.warnings = [
      "Estimated cost unavailable: S3 charges depend on storage, requests and transfer.",
      "The bucket name is not reserved until creation.",
    ];
    return review;
  }
  const ec2 = new EC2Client(config(session, c.region));
  try {
    const imageRes = await ec2.send(
      new DescribeImagesCommand({
        Owners: ["amazon"],
        ...(pinned?.imageId
          ? { ImageIds: [pinned.imageId] }
          : {
              Filters: [
                {
                  Name: "name",
                  Values: [`al2023-ami-2023*-kernel-6.1-${c.architecture}`],
                },
                { Name: "architecture", Values: [c.architecture] },
                { Name: "state", Values: ["available"] },
                { Name: "root-device-type", Values: ["ebs"] },
                { Name: "virtualization-type", Values: ["hvm"] },
              ],
            }),
      }),
    );
    const image = imageRes.Images?.filter(
      (i) =>
        i.State === "available" &&
        i.Architecture === c.architecture &&
        i.RootDeviceType === "ebs" &&
        i.VirtualizationType === "hvm",
    ).sort((a, b) =>
      (b.CreationDate ?? "").localeCompare(a.CreationDate ?? ""),
    )[0];
    if (!image?.ImageId || !image.RootDeviceName)
      reject("No approved Amazon Linux image is available in this region.");
    if (
      (image.BlockDeviceMappings ?? []).some(
        (b) => b.DeviceName !== image.RootDeviceName,
      )
    )
      reject("This image has additional storage mappings and is not approved.");
    if (
      c.storageGiB <
      (image.BlockDeviceMappings?.find(
        (b) => b.DeviceName === image.RootDeviceName,
      )?.Ebs?.VolumeSize ?? 8)
    )
      reject("Storage is smaller than the image requires.");
    const typeRes = await ec2.send(
      new DescribeInstanceTypesCommand({ InstanceTypes: [c.instanceType] }),
    );
    const type = typeRes.InstanceTypes?.[0];
    if (!type?.ProcessorInfo?.SupportedArchitectures?.includes(c.architecture))
      reject("This instance type does not support the selected architecture.");
    const sub = await ec2.send(
      new DescribeSubnetsCommand({ SubnetIds: [c.subnetId] }),
    );
    const subnet = sub.Subnets?.[0];
    if (
      !subnet ||
      subnet.OwnerId !== session.accountId ||
      subnet.VpcId !== c.vpcId ||
      subnet.State !== "available" ||
      subnet.AssignIpv6AddressOnCreation
    )
      reject(
        "Select an available subnet in this account and VPC without automatic IPv6 assignment.",
      );
    const groups = await ec2.send(
      new DescribeSecurityGroupsCommand({ GroupIds: c.securityGroupIds }),
    );
    const publicIngress = validateSecurityGroups(
      groups.SecurityGroups ?? [],
      c,
      session.accountId,
    );
    if (c.keyName) {
      const keys = await ec2.send(
        new DescribeKeyPairsCommand({ KeyNames: [c.keyName] }),
      );
      if (keys.KeyPairs?.length !== 1)
        reject("Select an existing key pair in this region.");
    }
    Object.assign(review, {
      imageId: image.ImageId,
      rootDeviceName: image.RootDeviceName,
      vcpu: type.VCpuInfo?.DefaultVCpus,
      memoryMiB: type.MemoryInfo?.SizeInMiB,
      networkExposure: c.publicIpv4
        ? "Public IPv4 requested; inbound access depends on selected security groups and routing"
        : "No public IPv4; no automatic IPv6",
    });
    if (c.publicIpv4 || publicIngress)
      review.warnings.push(
        "Public network exposure requested. Confirm explicitly before deployment.",
      );
    review.requiredPermissions = ["ec2:RunInstances", "ec2:CreateTags"];
    let dryRun = false;
    try {
      await ec2.send(
        new RunInstancesCommand({
          ...runInput(c, review, token),
          DryRun: true,
        }),
      );
    } catch (e) {
      if ((e as { name?: string }).name === "DryRunOperation") dryRun = true;
      else throw e;
    }
    if (!dryRun) reject("AWS did not confirm the creation permission check.");
    const prices = await loadPriceBook(
      session,
      {
        ebs: [[c.region, "gp3"]],
        instances: [[c.region, c.instanceType]],
        snapshots: [],
        ipv4: [],
      },
      2,
    );
    const hourly = prices.instanceHourly(c.region, c.instanceType),
      storage = prices.ebsGbMonth(c.region, "gp3");
    if (hourly !== null && storage !== null && !c.publicIpv4)
      review.estimatedMonthlyUsd =
        Math.round((hourly * 730 + storage * c.storageGiB) * 100) / 100;
    review.warnings.push(
      "Estimated cost uses 730 hours/month and excludes transfer, taxes, discounts and other services. Actual billing varies.",
    );
    if (review.estimatedMonthlyUsd === null)
      review.warnings.push("A reliable total estimated cost is unavailable.");
    return review;
  } finally {
    ec2.destroy();
  }
}
export async function countInstances(
  session: AwsSession,
  regions: string[],
): Promise<number> {
  let count = 0;
  for (const region of regions) {
    const ec2 = new EC2Client(config(session, region));
    try {
      let NextToken: string | undefined;
      do {
        const res = await ec2.send(
          new DescribeInstancesCommand({
            NextToken,
            MaxResults: 1000,
            Filters: [
              {
                Name: "instance-state-name",
                Values: [
                  "pending",
                  "running",
                  "stopping",
                  "stopped",
                  "shutting-down",
                ],
              },
            ],
          }),
        );
        count += (res.Reservations ?? []).reduce(
          (n, r) => n + (r.Instances?.length ?? 0),
          0,
        );
        NextToken = res.NextToken;
      } while (NextToken);
    } finally {
      ec2.destroy();
    }
  }
  return count;
}
export async function createResource(
  session: AwsSession,
  c: Configuration,
  review: Review,
  token: string,
  checkpoint: (id: string) => Promise<void>,
): Promise<string> {
  if (c.service === "vpc" || c.service === "subnet") return createNetwork(session, c, review, token, checkpoint);
  if (c.service === "ec2") {
    const ec2 = new EC2Client(config(session, c.region, true));
    try {
      const res = await ec2.send(
        new RunInstancesCommand(runInput(c, review, token)),
      );
      const id = res.Instances?.[0]?.InstanceId;
      if (!id)
        reject(
          "AWS did not return an instance identifier. Reconciliation is required.",
        );
      await checkpoint(id);
      return id;
    } finally {
      ec2.destroy();
    }
  }
  const s3 = new S3Client(config(session, c.region, true));
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: c.name,
        ...(c.region === "us-east-1"
          ? {}
          : {
              CreateBucketConfiguration: {
                LocationConstraint: c.region as BucketLocationConstraint,
              },
            }),
      }),
    );
    await checkpoint(c.name);
    const owner = { Bucket: c.name, ExpectedBucketOwner: session.accountId };
    await s3.send(
      new PutPublicAccessBlockCommand({
        ...owner,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
    await s3.send(
      new PutBucketEncryptionCommand({
        ...owner,
        ServerSideEncryptionConfiguration: {
          Rules: [
            { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
          ],
        },
      }),
    );
    if (c.versioning)
      await s3.send(
        new PutBucketVersioningCommand({
          ...owner,
          VersioningConfiguration: { Status: "Enabled" },
        }),
      );
    await s3.send(
      new PutBucketTaggingCommand({
        ...owner,
        Tagging: {
          TagSet: Object.entries(review.tags).map(([Key, Value]) => ({
            Key,
            Value,
          })),
        },
      }),
    );
    return c.name;
  } finally {
    s3.destroy();
  }
}
export async function verifyResource(
  session: AwsSession,
  c: Configuration,
  review: Review,
  resourceId: string,
): Promise<NormalizedResource> {
  if (c.service === "vpc" || c.service === "subnet") return verifyNetwork(session, c, review, resourceId);
  if (c.service === "ec2") {
    const ec2 = new EC2Client(config(session, c.region));
    try {
      const res = await ec2.send(
        new DescribeInstancesCommand({ InstanceIds: [resourceId] }),
      );
      const reservation = res.Reservations?.[0],
        i = reservation?.Instances?.[0];
      if (
        reservation?.OwnerId !== session.accountId ||
        !i ||
        !["pending", "running"].includes(i.State?.Name ?? "")
      )
        reject(
          "The instance is not yet verified as pending or running. Reconcile this deployment.",
        );
      const actual = Object.fromEntries(
        (i.Tags ?? []).map((t) => [t.Key, t.Value]),
      );
      if (
        Object.entries(review.tags).some(([k, v]) => actual[k] !== v) ||
        i.ImageId !== review.imageId ||
        i.SubnetId !== c.subnetId ||
        i.InstanceType !== c.instanceType
      )
        reject("Instance metadata does not match the approved plan.");
      if (
        i.MetadataOptions?.HttpTokens !== "required" ||
        (!c.publicIpv4 && i.PublicIpAddress) ||
        (i.NetworkInterfaces ?? []).some(
          (n) => (n.Ipv6Addresses ?? []).length > 0,
        )
      )
        reject(
          "Instance network or metadata protection does not match the plan.",
        );
      const volumeIds = (i.BlockDeviceMappings ?? [])
        .map((b) => b.Ebs?.VolumeId)
        .filter((id): id is string => Boolean(id));
      if (volumeIds.length !== 1)
        reject("Instance storage could not be verified.");
      const volumes = (
        await ec2.send(new DescribeVolumesCommand({ VolumeIds: volumeIds }))
      ).Volumes;
      if (
        volumes?.length !== 1 ||
        !volumes[0].Encrypted ||
        volumes[0].Size !== c.storageGiB ||
        volumes[0].VolumeType !== "gp3"
      )
        reject("Encrypted instance storage does not match the plan.");
      const normalized = normalizeInstance(i, c.region, session.accountId);
      if (!normalized) reject("Instance metadata unavailable.");
      return normalized;
    } finally {
      ec2.destroy();
    }
  }
  const s3 = new S3Client(config(session, c.region));
  try {
    const owner = {
      Bucket: resourceId,
      ExpectedBucketOwner: session.accountId,
    };
    const head = await s3.send(new HeadBucketCommand(owner));
    if (head.BucketRegion && head.BucketRegion !== c.region)
      reject("Bucket region mismatch.");
    const publicAccess = (await s3.send(new GetPublicAccessBlockCommand(owner)))
      .PublicAccessBlockConfiguration;
    if (
      !publicAccess?.BlockPublicAcls ||
      !publicAccess.IgnorePublicAcls ||
      !publicAccess.BlockPublicPolicy ||
      !publicAccess.RestrictPublicBuckets
    )
      reject("Bucket public access protection could not be verified.");
    const encryption = (await s3.send(new GetBucketEncryptionCommand(owner)))
      .ServerSideEncryptionConfiguration;
    if (
      encryption?.Rules?.[0]?.ApplyServerSideEncryptionByDefault
        ?.SSEAlgorithm !== "AES256"
    )
      reject("Bucket encryption could not be verified.");
    const ownership = (
      await s3.send(new GetBucketOwnershipControlsCommand(owner))
    ).OwnershipControls;
    if (ownership?.Rules?.[0]?.ObjectOwnership !== "BucketOwnerEnforced")
      reject("Bucket ownership protection could not be verified.");
    const version = (await s3.send(new GetBucketVersioningCommand(owner)))
      .Status;
    if (c.versioning && version !== "Enabled")
      reject("Bucket versioning could not be verified.");
    const tagSet =
      (await s3.send(new GetBucketTaggingCommand(owner))).TagSet ?? [];
    const actual = Object.fromEntries(tagSet.map((t) => [t.Key, t.Value]));
    if (Object.entries(review.tags).some(([k, v]) => actual[k] !== v))
      reject("Bucket tags do not match the approved plan.");
    return {
      resourceType: "s3:bucket",
      region: c.region,
      resourceId,
      arn: `arn:aws:s3:::${resourceId}`,
      name: resourceId,
      state: "available",
      tags: review.tags,
      attributes: {
        creationDate: null,
        versioning: { ok: true, value: version ?? "Disabled" },
        encryption: {
          ok: true,
          value: {
            algorithm: "AES256",
            kmsKeyId: null,
            bucketKeyEnabled: false,
          },
        },
        publicAccessBlock: {
          ok: true,
          value: {
            blockPublicAcls: true,
            ignorePublicAcls: true,
            blockPublicPolicy: true,
            restrictPublicBuckets: true,
          },
        },
        accountPublicAccessBlock: { ok: false, reason: "error" },
        policyIsPublic: { ok: false, reason: "error" },
        aclPublicGrants: { ok: false, reason: "error" },
        logging: { ok: false, reason: "error" },
        lifecycleRuleCount: { ok: false, reason: "error" },
      } satisfies S3BucketAttrs,
    };
  } finally {
    s3.destroy();
  }
}

/** Eventual consistency: bounded retries only around read-only verification. */
export async function verifyWithPolling(
  session: AwsSession,
  c: Configuration,
  review: Review,
  id: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await verifyResource(session, c, review, id);
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

/** Resolve a lost create response from the server-owned idempotency token/name. */
export async function locateResource(
  session: AwsSession,
  c: Configuration,
  planId: string,
): Promise<string | null> {
  if (c.service === "vpc" || c.service === "subnet") return locateNetwork(session, c, planId);
  if (c.service === "s3") {
    const s3 = new S3Client(config(session, c.region));
    try {
      await s3.send(
        new HeadBucketCommand({
          Bucket: c.name,
          ExpectedBucketOwner: session.accountId,
        }),
      );
      return c.name;
    } catch (e) {
      if (
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return null;
      throw e;
    } finally {
      s3.destroy();
    }
  }
  const ec2 = new EC2Client(config(session, c.region));
  try {
    const result = await ec2.send(
      new DescribeInstancesCommand({
        Filters: [{ Name: "client-token", Values: [planId] }],
      }),
    );
    const reservations = result.Reservations ?? [];
    if (reservations.some((r) => r.OwnerId !== session.accountId))
      reject("Instance account mismatch.");
    const instances = reservations.flatMap((r) => r.Instances ?? []);
    if (instances.length > 1)
      reject("Multiple instances matched. Manual investigation is required.");
    return instances[0]?.InstanceId ?? null;
  } finally {
    ec2.destroy();
  }
}
