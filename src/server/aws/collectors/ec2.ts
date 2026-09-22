import "server-only";
import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  EC2Client,
  type Instance,
} from "@aws-sdk/client-ec2";
import {
  RESOURCE_TYPES,
  type EbsSnapshotAttrs,
  type EbsVolumeAttrs,
  type Ec2InstanceAttrs,
  type ElasticIpAttrs,
} from "@/lib/resource-types";
import { createAwsClient } from "../client-factory";
import { paginate } from "../paginate";
import { iso, nameTag, tagsToRecord, type Collector, type CollectorContext, type NormalizedResource } from "./types";

async function withEc2<T>(ctx: CollectorContext, fn: (c: EC2Client) => Promise<T>): Promise<T> {
  const client = createAwsClient(EC2Client, ctx.session, ctx.region, "ec2");
  try {
    return await fn(client);
  } finally {
    client.destroy();
  }
}

/** "User initiated (2026-08-10 12:00:00 GMT)" → ISO timestamp. */
export function parseStoppedAt(reason: string | undefined): string | null {
  const m = reason ? /\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) GMT\)/.exec(reason) : null;
  return m ? iso(`${m[1]!.replace(" ", "T")}Z`) : null;
}

export function normalizeInstance(i: Instance, region: string, accountId: string): NormalizedResource<Ec2InstanceAttrs> | null {
  if (!i.InstanceId) return null;
  const tags = tagsToRecord(i.Tags);
  const attrs: Ec2InstanceAttrs = {
    instanceType: i.InstanceType ?? "unknown",
    architecture: i.Architecture ?? null,
    availabilityZone: i.Placement?.AvailabilityZone ?? null,
    publicIp: i.PublicIpAddress ?? null,
    privateIp: i.PrivateIpAddress ?? null,
    vpcId: i.VpcId ?? null,
    subnetId: i.SubnetId ?? null,
    securityGroups: (i.SecurityGroups ?? []).filter((g) => g.GroupId).map((g) => ({ id: g.GroupId!, name: g.GroupName ?? null })),
    iamInstanceProfileArn: i.IamInstanceProfile?.Arn ?? null,
    launchTime: iso(i.LaunchTime),
    platform: i.PlatformDetails ?? null,
    monitoring: i.Monitoring?.State ?? null,
    volumeIds: (i.BlockDeviceMappings ?? []).map((b) => b.Ebs?.VolumeId).filter((v): v is string => Boolean(v)),
    stateReason: i.StateTransitionReason ? i.StateTransitionReason.slice(0, 200) : null,
    stoppedAt: i.State?.Name === "stopped" ? parseStoppedAt(i.StateTransitionReason) : null,
  };
  return {
    resourceType: RESOURCE_TYPES.EC2_INSTANCE,
    region,
    resourceId: i.InstanceId,
    arn: `arn:aws:ec2:${region}:${accountId}:instance/${i.InstanceId}`,
    name: nameTag(tags),
    state: i.State?.Name ?? null,
    attributes: attrs,
    tags,
    searchTerms: [attrs.publicIp, attrs.privateIp, attrs.instanceType].filter((x): x is string => Boolean(x)),
  };
}

export const ec2InstancesCollector: Collector = {
  id: "ec2:instances",
  resourceTypes: [RESOURCE_TYPES.EC2_INSTANCE],
  scope: "regional",
  iamAction: "ec2:DescribeInstances",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      const reservations = await paginate(
        (NextToken) => ec2.send(new DescribeInstancesCommand({ NextToken, MaxResults: 1000 })),
        (p) => ({ items: p.Reservations, nextToken: p.NextToken }),
      );
      return reservations
        .flatMap((r) => r.Instances ?? [])
        .filter((i) => i.State?.Name !== "terminated")
        .map((i) => normalizeInstance(i, ctx.region, ctx.accountId))
        .filter((r): r is NormalizedResource<Ec2InstanceAttrs> => r !== null);
    }),
};

export const ebsVolumesCollector: Collector = {
  id: "ec2:volumes",
  resourceTypes: [RESOURCE_TYPES.EBS_VOLUME],
  scope: "regional",
  iamAction: "ec2:DescribeVolumes",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      const volumes = await paginate(
        (NextToken) => ec2.send(new DescribeVolumesCommand({ NextToken, MaxResults: 500 })),
        (p) => ({ items: p.Volumes, nextToken: p.NextToken }),
      );
      return volumes
        .filter((v) => v.VolumeId)
        .map((v): NormalizedResource<EbsVolumeAttrs> => {
          const tags = tagsToRecord(v.Tags);
          return {
            resourceType: RESOURCE_TYPES.EBS_VOLUME,
            region: ctx.region,
            resourceId: v.VolumeId!,
            arn: `arn:aws:ec2:${ctx.region}:${ctx.accountId}:volume/${v.VolumeId}`,
            name: nameTag(tags),
            state: v.State ?? null,
            tags,
            attributes: {
              sizeGiB: v.Size ?? 0,
              volumeType: v.VolumeType ?? null,
              encrypted: Boolean(v.Encrypted),
              availabilityZone: v.AvailabilityZone ?? null,
              attachedInstanceIds: (v.Attachments ?? []).map((a) => a.InstanceId).filter((x): x is string => Boolean(x)),
              createTime: iso(v.CreateTime),
            },
          };
        });
    }),
};

export const ebsSnapshotsCollector: Collector = {
  id: "ec2:snapshots",
  resourceTypes: [RESOURCE_TYPES.EBS_SNAPSHOT],
  scope: "regional",
  iamAction: "ec2:DescribeSnapshots",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      // OwnerIds=self: only snapshots this account owns (public/shared snapshots excluded).
      const snaps = await paginate(
        (NextToken) => ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"], NextToken, MaxResults: 1000 })),
        (p) => ({ items: p.Snapshots, nextToken: p.NextToken }),
      );
      return snaps
        .filter((s) => s.SnapshotId)
        .map((s): NormalizedResource<EbsSnapshotAttrs> => {
          const tags = tagsToRecord(s.Tags);
          return {
            resourceType: RESOURCE_TYPES.EBS_SNAPSHOT,
            region: ctx.region,
            resourceId: s.SnapshotId!,
            arn: `arn:aws:ec2:${ctx.region}::snapshot/${s.SnapshotId}`,
            name: nameTag(tags),
            state: s.State ?? null,
            tags,
            attributes: { volumeId: s.VolumeId ?? null, sizeGiB: s.VolumeSize ?? 0, startTime: iso(s.StartTime), encrypted: Boolean(s.Encrypted) },
          };
        });
    }),
};

export const elasticIpsCollector: Collector = {
  id: "ec2:addresses",
  resourceTypes: [RESOURCE_TYPES.ELASTIC_IP],
  scope: "regional",
  iamAction: "ec2:DescribeAddresses",
  collect: (ctx) =>
    withEc2(ctx, async (ec2) => {
      const res = await ec2.send(new DescribeAddressesCommand({}));
      return (res.Addresses ?? [])
        .filter((a) => a.AllocationId || a.PublicIp)
        .map((a): NormalizedResource<ElasticIpAttrs> => {
          const tags = tagsToRecord(a.Tags);
          const id = a.AllocationId ?? a.PublicIp!;
          return {
            resourceType: RESOURCE_TYPES.ELASTIC_IP,
            region: ctx.region,
            resourceId: id,
            arn: a.AllocationId ? `arn:aws:ec2:${ctx.region}:${ctx.accountId}:elastic-ip/${a.AllocationId}` : null,
            name: nameTag(tags) ?? a.PublicIp ?? null,
            state: a.AssociationId ? "associated" : "unassociated",
            tags,
            attributes: { publicIp: a.PublicIp ?? null, allocationId: a.AllocationId ?? null, instanceId: a.InstanceId ?? null, associationId: a.AssociationId ?? null },
            searchTerms: a.PublicIp ? [a.PublicIp] : [],
          };
        });
    }),
};
