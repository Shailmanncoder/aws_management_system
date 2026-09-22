import "server-only";
import {
  GetBucketAclCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetBucketLoggingCommand,
  GetBucketPolicyStatusCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  ListBucketsCommand,
  S3Client,
  type Bucket,
} from "@aws-sdk/client-s3";
import { GetPublicAccessBlockCommand as GetAccountPabCommand, S3ControlClient } from "@aws-sdk/client-s3-control";
import { RESOURCE_TYPES, type Observed, type PublicAccessBlock, type S3BucketAttrs } from "@/lib/resource-types";
import { createAwsClient } from "../client-factory";
import { mapSettledLimit } from "../concurrency";
import { classifyAwsError } from "../errors";
import { paginate } from "../paginate";
import { globalRegionFor, isKnownRegion } from "../regions-catalog";
import { GLOBAL_REGION, iso, observe, tagsToRecord, type Collector, type NormalizedResource } from "./types";

const ALL_USERS = "http://acs.amazonaws.com/groups/global/AllUsers";
const AUTH_USERS = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";

function toPab(c: { BlockPublicAcls?: boolean; IgnorePublicAcls?: boolean; BlockPublicPolicy?: boolean; RestrictPublicBuckets?: boolean } | undefined): PublicAccessBlock | null {
  if (!c) return null;
  return {
    blockPublicAcls: Boolean(c.BlockPublicAcls),
    ignorePublicAcls: Boolean(c.IgnorePublicAcls),
    blockPublicPolicy: Boolean(c.BlockPublicPolicy),
    restrictPublicBuckets: Boolean(c.RestrictPublicBuckets),
  };
}

/** Bucket region: prefer the ListBuckets BucketRegion field, fall back to GetBucketLocation. */
async function resolveRegion(bucket: Bucket, home: S3Client): Promise<string | null> {
  if (bucket.BucketRegion && isKnownRegion(bucket.BucketRegion)) return bucket.BucketRegion;
  const loc = await home.send(new GetBucketLocationCommand({ Bucket: bucket.Name }));
  const region = !loc.LocationConstraint ? "us-east-1" : loc.LocationConstraint === "EU" ? "eu-west-1" : loc.LocationConstraint;
  return isKnownRegion(region) ? region : null;
}

export const s3BucketsCollector: Collector = {
  id: "s3:buckets",
  resourceTypes: [RESOURCE_TYPES.S3_BUCKET],
  scope: "global",
  iamAction: "s3:ListAllMyBuckets",
  async collect(ctx) {
    const homeRegion = globalRegionFor(ctx.session.partition);
    const clients = new Map<string, S3Client>();
    const clientFor = (region: string) => {
      let c = clients.get(region);
      if (!c) {
        c = createAwsClient(S3Client, ctx.session, region, "s3");
        clients.set(region, c);
      }
      return c;
    };
    const control = createAwsClient(S3ControlClient, ctx.session, homeRegion, "s3control");
    try {
      const home = clientFor(homeRegion);
      const buckets = await paginate(
        (ContinuationToken) => home.send(new ListBucketsCommand({ ContinuationToken, MaxBuckets: 1000 })),
        (p) => ({ items: p.Buckets, nextToken: p.ContinuationToken }),
      );

      // Account-level Block Public Access overrides bucket settings; read it once.
      const accountPab: Observed<PublicAccessBlock | null> = await observe(
        async () => toPab((await control.send(new GetAccountPabCommand({ AccountId: ctx.accountId }))).PublicAccessBlockConfiguration),
        { value: null },
      );

      const settled = await mapSettledLimit(buckets.filter((b) => b.Name), 8, async (b): Promise<NormalizedResource<S3BucketAttrs>> => {
        const name = b.Name!;
        const region = (await resolveRegion(b, home)) ?? homeRegion;
        const s3 = clientFor(region);
        const [encryption, versioning, publicAccessBlock, policyIsPublic, aclPublicGrants, logging, lifecycleRuleCount, tagSet] = await Promise.all([
          observe(async () => {
            const rule = (await s3.send(new GetBucketEncryptionCommand({ Bucket: name }))).ServerSideEncryptionConfiguration?.Rules?.[0];
            const d = rule?.ApplyServerSideEncryptionByDefault;
            return d?.SSEAlgorithm ? { algorithm: d.SSEAlgorithm, kmsKeyId: d.KMSMasterKeyID ?? null, bucketKeyEnabled: Boolean(rule?.BucketKeyEnabled) } : null;
          }, { value: null }),
          observe(async () => ((await s3.send(new GetBucketVersioningCommand({ Bucket: name }))).Status ?? "Disabled") as "Enabled" | "Suspended" | "Disabled"),
          observe(async () => toPab((await s3.send(new GetPublicAccessBlockCommand({ Bucket: name }))).PublicAccessBlockConfiguration), { value: null }),
          observe(async () => Boolean((await s3.send(new GetBucketPolicyStatusCommand({ Bucket: name }))).PolicyStatus?.IsPublic) as boolean | null, { value: null }),
          observe(async () =>
            ((await s3.send(new GetBucketAclCommand({ Bucket: name }))).Grants ?? [])
              .filter((g) => g.Grantee?.URI === ALL_USERS || g.Grantee?.URI === AUTH_USERS)
              .map((g) => `${g.Grantee?.URI === ALL_USERS ? "AllUsers" : "AuthenticatedUsers"}:${g.Permission ?? "?"}`),
          ),
          observe(async () => {
            const l = (await s3.send(new GetBucketLoggingCommand({ Bucket: name }))).LoggingEnabled;
            return { enabled: Boolean(l), targetBucket: l?.TargetBucket ?? null };
          }),
          observe(async () => (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: name }))).Rules?.length ?? 0, { value: 0 }),
          observe(async () => tagsToRecord((await s3.send(new GetBucketTaggingCommand({ Bucket: name }))).TagSet), { value: {} }),
        ]);
        return {
          resourceType: RESOURCE_TYPES.S3_BUCKET,
          region,
          resourceId: name,
          arn: `arn:aws:s3:::${name}`,
          name,
          state: null,
          tags: tagSet.ok ? tagSet.value : {},
          attributes: {
            creationDate: iso(b.CreationDate),
            encryption,
            versioning,
            publicAccessBlock,
            accountPublicAccessBlock: accountPab,
            policyIsPublic,
            aclPublicGrants,
            logging,
            lifecycleRuleCount,
          },
        };
      });
      const listed = buckets.filter((b) => b.Name);
      const failures = settled.filter((s) => s.status === "rejected");
      if (failures.length > 0 && failures.length === settled.length) throw (failures[0] as PromiseRejectedResult).reason;
      // Throttling is transient: retry the whole collector rather than overwrite good data with "unknown".
      const throttled = failures.find((f) => classifyAwsError((f as PromiseRejectedResult).reason) === "throttled");
      if (throttled) throw (throttled as PromiseRejectedResult).reason;
      // A bucket whose configuration could not be read is still emitted (all attributes
      // "unknown") so it is never mistaken for a deleted bucket.
      const unknown = { ok: false as const, reason: "error" as const };
      return settled.map((s, i) =>
        s.status === "fulfilled"
          ? s.value
          : {
              resourceType: RESOURCE_TYPES.S3_BUCKET,
              region: listed[i]!.BucketRegion && isKnownRegion(listed[i]!.BucketRegion) ? listed[i]!.BucketRegion! : homeRegion,
              resourceId: listed[i]!.Name!,
              arn: `arn:aws:s3:::${listed[i]!.Name}`,
              name: listed[i]!.Name!,
              state: null,
              tags: {},
              attributes: {
                creationDate: iso(listed[i]!.CreationDate),
                encryption: unknown,
                versioning: unknown,
                publicAccessBlock: unknown,
                accountPublicAccessBlock: accountPab,
                policyIsPublic: unknown,
                aclPublicGrants: unknown,
                logging: unknown,
                lifecycleRuleCount: unknown,
              },
            },
      );
    } finally {
      for (const c of clients.values()) c.destroy();
      control.destroy();
    }
  },
};

/** S3 buckets are stored with their real region; the collector itself runs once ("global"). */
export const S3_COLLECTOR_REGION = GLOBAL_REGION;
