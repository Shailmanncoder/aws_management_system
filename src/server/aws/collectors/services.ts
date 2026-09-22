import "server-only";
import { APIGatewayClient, GetRestApisCommand } from "@aws-sdk/client-api-gateway";
import { ApiGatewayV2Client, GetApisCommand } from "@aws-sdk/client-apigatewayv2";
import { CloudFrontClient, ListDistributionsCommand } from "@aws-sdk/client-cloudfront";
import { DescribeContinuousBackupsCommand, DescribeTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DescribeImagesCommand, DescribeRepositoriesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { DescribeClustersCommand, DescribeServicesCommand, ECSClient, ListClustersCommand, ListServicesCommand } from "@aws-sdk/client-ecs";
import { DescribeClusterCommand, EKSClient, ListClustersCommand as ListEksClustersCommand } from "@aws-sdk/client-eks";
import { DescribeLoadBalancersCommand, DescribeTagsCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { LambdaClient, ListFunctionsCommand, ListTagsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { ListHostedZonesCommand, Route53Client } from "@aws-sdk/client-route-53";
import { ListTopicsCommand, SNSClient } from "@aws-sdk/client-sns";
import { GetQueueAttributesCommand, ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  RESOURCE_TYPES,
  type DynamoTableAttrs,
  type EcrRepositoryAttrs,
  type EcsClusterAttrs,
  type EcsServiceAttrs,
  type EksClusterAttrs,
  type LambdaAttrs,
  type LoadBalancerAttrs,
  type RdsClusterAttrs,
  type RdsInstanceAttrs,
} from "@/lib/resource-types";
import { createAwsClient } from "../client-factory";
import { mapSettledLimit } from "../concurrency";
import { paginate } from "../paginate";
import { globalRegionFor } from "../regions-catalog";
import { GLOBAL_REGION, iso, observe, tagsToRecord, type Collector, type CollectorContext, type NormalizedResource } from "./types";

type Destroyable = { destroy(): void };
async function using<C extends Destroyable, T>(client: C, fn: (c: C) => Promise<T>): Promise<T> {
  try {
    return await fn(client);
  } finally {
    client.destroy();
  }
}

/**
 * Per-item results must be complete: dropping a failed item would make stale-marking treat it
 * as deleted. Any failure fails the collector (which is then retried / reported per region).
 */
function allOrThrow<T>(settled: PromiseSettledResult<T>[]): T[] {
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value);
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ─────────────────────────── Databases ───────────────────────────

export const rdsCollector: Collector = {
  id: "rds:databases",
  resourceTypes: [RESOURCE_TYPES.RDS_INSTANCE, RESOURCE_TYPES.RDS_CLUSTER],
  scope: "regional",
  iamAction: "rds:DescribeDBInstances",
  collect: (ctx) =>
    using(createAwsClient(RDSClient, ctx.session, ctx.region, "rds"), async (rds) => {
      const [instances, clusters] = await Promise.all([
        paginate((Marker) => rds.send(new DescribeDBInstancesCommand({ Marker, MaxRecords: 100 })), (p) => ({ items: p.DBInstances, nextToken: p.Marker })),
        paginate((Marker) => rds.send(new DescribeDBClustersCommand({ Marker, MaxRecords: 100 })), (p) => ({ items: p.DBClusters, nextToken: p.Marker })),
      ]);
      const out: NormalizedResource[] = [];
      for (const d of instances) {
        if (!d.DBInstanceIdentifier) continue;
        const tags = tagsToRecord(d.TagList);
        // Allow-list: MasterUsername, endpoints credentials, parameter groups are NOT copied.
        const attrs: RdsInstanceAttrs = {
          engine: d.Engine ?? "unknown",
          engineVersion: d.EngineVersion ?? null,
          instanceClass: d.DBInstanceClass ?? null,
          allocatedStorageGiB: d.AllocatedStorage ?? null,
          encrypted: Boolean(d.StorageEncrypted),
          publiclyAccessible: Boolean(d.PubliclyAccessible),
          multiAz: Boolean(d.MultiAZ),
          backupRetentionDays: d.BackupRetentionPeriod ?? 0,
          vpcId: d.DBSubnetGroup?.VpcId ?? null,
          subnetIds: (d.DBSubnetGroup?.Subnets ?? []).map((s) => s.SubnetIdentifier).filter((x): x is string => Boolean(x)),
          securityGroupIds: (d.VpcSecurityGroups ?? []).map((g) => g.VpcSecurityGroupId).filter((x): x is string => Boolean(x)),
          endpointAddress: d.Endpoint?.Address ?? null,
          endpointPort: d.Endpoint?.Port ?? null,
          clusterId: d.DBClusterIdentifier ?? null,
          availabilityZone: d.AvailabilityZone ?? null,
        };
        out.push({ resourceType: RESOURCE_TYPES.RDS_INSTANCE, region: ctx.region, resourceId: d.DBInstanceIdentifier, arn: d.DBInstanceArn ?? null, name: d.DBInstanceIdentifier, state: d.DBInstanceStatus ?? null, tags, attributes: attrs, searchTerms: [attrs.engine, attrs.endpointAddress ?? ""] });
      }
      for (const c of clusters) {
        if (!c.DBClusterIdentifier) continue;
        const attrs: RdsClusterAttrs = {
          engine: c.Engine ?? "unknown",
          engineVersion: c.EngineVersion ?? null,
          engineMode: c.EngineMode ?? null,
          encrypted: Boolean(c.StorageEncrypted),
          memberIds: (c.DBClusterMembers ?? []).map((m) => m.DBInstanceIdentifier).filter((x): x is string => Boolean(x)),
        };
        out.push({ resourceType: RESOURCE_TYPES.RDS_CLUSTER, region: ctx.region, resourceId: c.DBClusterIdentifier, arn: c.DBClusterArn ?? null, name: c.DBClusterIdentifier, state: c.Status ?? null, tags: tagsToRecord(c.TagList), attributes: attrs });
      }
      return out;
    }),
};

export const dynamoCollector: Collector = {
  id: "dynamodb:tables",
  resourceTypes: [RESOURCE_TYPES.DYNAMODB_TABLE],
  scope: "regional",
  iamAction: "dynamodb:ListTables",
  collect: (ctx) =>
    using(createAwsClient(DynamoDBClient, ctx.session, ctx.region, "dynamodb"), async (ddb) => {
      const names = await paginate(
        (ExclusiveStartTableName) => ddb.send(new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 })),
        (p) => ({ items: p.TableNames, nextToken: p.LastEvaluatedTableName }),
      );
      const settled = await mapSettledLimit(names, 5, async (TableName): Promise<NormalizedResource<DynamoTableAttrs>> => {
        const t = (await ddb.send(new DescribeTableCommand({ TableName }))).Table;
        const pitr = await observe(async () => (await ddb.send(new DescribeContinuousBackupsCommand({ TableName }))).ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === "ENABLED");
        return {
          resourceType: RESOURCE_TYPES.DYNAMODB_TABLE,
          region: ctx.region,
          resourceId: TableName,
          arn: t?.TableArn ?? null,
          name: TableName,
          state: t?.TableStatus ?? null,
          tags: {},
          attributes: {
            billingMode: t?.BillingModeSummary?.BillingMode ?? "PROVISIONED",
            readCapacity: t?.ProvisionedThroughput?.ReadCapacityUnits ?? null,
            writeCapacity: t?.ProvisionedThroughput?.WriteCapacityUnits ?? null,
            itemCount: t?.ItemCount ?? null,
            sizeBytes: t?.TableSizeBytes ?? null,
            sseType: t?.SSEDescription?.SSEType ?? (t?.SSEDescription?.Status === "ENABLED" ? "KMS" : "AWS_OWNED"),
            pointInTimeRecovery: pitr,
            createdAt: iso(t?.CreationDateTime),
          },
        };
      });
      return allOrThrow(settled);
    }),
};

// ─────────────────────────── Serverless ───────────────────────────

export const lambdaCollector: Collector = {
  id: "lambda:functions",
  resourceTypes: [RESOURCE_TYPES.LAMBDA_FUNCTION],
  scope: "regional",
  iamAction: "lambda:ListFunctions",
  collect: (ctx) =>
    using(createAwsClient(LambdaClient, ctx.session, ctx.region, "lambda"), async (lambda) => {
      const fns = await paginate((Marker) => lambda.send(new ListFunctionsCommand({ Marker, MaxItems: 50 })), (p) => ({ items: p.Functions, nextToken: p.NextMarker }));
      const settled = await mapSettledLimit(fns.filter((f) => f.FunctionName), 5, async (f): Promise<NormalizedResource<LambdaAttrs>> => {
        const tags = await observe(async () => tagsToRecord((await lambda.send(new ListTagsCommand({ Resource: f.FunctionArn }))).Tags), { value: {} });
        return {
          resourceType: RESOURCE_TYPES.LAMBDA_FUNCTION,
          region: ctx.region,
          resourceId: f.FunctionName!,
          arn: f.FunctionArn ?? null,
          name: f.FunctionName!,
          state: f.State ?? "Active",
          tags: tags.ok ? tags.value : {},
          attributes: {
            runtime: f.Runtime ?? (f.PackageType === "Image" ? "container-image" : null),
            memoryMb: f.MemorySize ?? null,
            timeoutSec: f.Timeout ?? null,
            architecture: f.Architectures?.[0] ?? "x86_64",
            lastModified: iso(f.LastModified),
            vpcId: f.VpcConfig?.VpcId || null,
            layerCount: f.Layers?.length ?? 0,
            packageType: f.PackageType ?? null,
            codeSizeBytes: f.CodeSize ?? null,
            // SECURITY: environment variables can contain secrets — only the count is kept.
            environmentVariableCount: Object.keys(f.Environment?.Variables ?? {}).length,
          },
        };
      });
      return allOrThrow(settled);
    }),
};

// ─────────────────────────── Containers ───────────────────────────

export const ecsCollector: Collector = {
  id: "ecs:clusters",
  resourceTypes: [RESOURCE_TYPES.ECS_CLUSTER, RESOURCE_TYPES.ECS_SERVICE],
  scope: "regional",
  iamAction: "ecs:ListClusters",
  collect: (ctx) =>
    using(createAwsClient(ECSClient, ctx.session, ctx.region, "ecs"), async (ecs) => {
      const arns = await paginate((nextToken) => ecs.send(new ListClustersCommand({ nextToken, maxResults: 100 })), (p) => ({ items: p.clusterArns, nextToken: p.nextToken }));
      const out: NormalizedResource[] = [];
      for (const batch of chunk(arns, 100)) {
        const clusters = (await ecs.send(new DescribeClustersCommand({ clusters: batch }))).clusters ?? [];
        for (const c of clusters) {
          if (!c.clusterArn) continue;
          const attrs: EcsClusterAttrs = {
            runningTasks: c.runningTasksCount ?? 0,
            pendingTasks: c.pendingTasksCount ?? 0,
            activeServices: c.activeServicesCount ?? 0,
            containerInstances: c.registeredContainerInstancesCount ?? 0,
          };
          out.push({ resourceType: RESOURCE_TYPES.ECS_CLUSTER, region: ctx.region, resourceId: c.clusterName ?? c.clusterArn, arn: c.clusterArn, name: c.clusterName ?? null, state: c.status ?? null, tags: tagsToRecord(c.tags?.map((t) => ({ Key: t.key, Value: t.value }))), attributes: attrs });
          const serviceArns = await paginate((nextToken) => ecs.send(new ListServicesCommand({ cluster: c.clusterArn, nextToken, maxResults: 100 })), (p) => ({ items: p.serviceArns, nextToken: p.nextToken }));
          for (const sb of chunk(serviceArns, 10)) {
            const services = (await ecs.send(new DescribeServicesCommand({ cluster: c.clusterArn, services: sb }))).services ?? [];
            for (const s of services) {
              if (!s.serviceArn) continue;
              const sa: EcsServiceAttrs = { clusterName: c.clusterName ?? null, desiredCount: s.desiredCount ?? 0, runningCount: s.runningCount ?? 0, launchType: s.launchType ?? (s.capacityProviderStrategy?.length ? "CAPACITY_PROVIDER" : null) };
              out.push({ resourceType: RESOURCE_TYPES.ECS_SERVICE, region: ctx.region, resourceId: `${c.clusterName}/${s.serviceName}`, arn: s.serviceArn, name: s.serviceName ?? null, state: s.status ?? null, tags: {}, attributes: sa });
            }
          }
        }
      }
      return out;
    }),
};

export const eksCollector: Collector = {
  id: "eks:clusters",
  resourceTypes: [RESOURCE_TYPES.EKS_CLUSTER],
  scope: "regional",
  iamAction: "eks:ListClusters",
  collect: (ctx) =>
    using(createAwsClient(EKSClient, ctx.session, ctx.region, "eks"), async (eks) => {
      const names = await paginate((nextToken) => eks.send(new ListEksClustersCommand({ nextToken, maxResults: 100 })), (p) => ({ items: p.clusters, nextToken: p.nextToken }));
      const out: NormalizedResource<EksClusterAttrs>[] = [];
      for (const name of names) {
        const c = (await eks.send(new DescribeClusterCommand({ name }))).cluster;
        if (!c?.name) continue;
        // certificateAuthority / identity (OIDC) data are intentionally not stored.
        out.push({
          resourceType: RESOURCE_TYPES.EKS_CLUSTER,
          region: ctx.region,
          resourceId: c.name,
          arn: c.arn ?? null,
          name: c.name,
          state: c.status ?? null,
          tags: tagsToRecord(c.tags),
          attributes: {
            version: c.version ?? null,
            platformVersion: c.platformVersion ?? null,
            endpointPublicAccess: Boolean(c.resourcesVpcConfig?.endpointPublicAccess),
            endpointPrivateAccess: Boolean(c.resourcesVpcConfig?.endpointPrivateAccess),
            publicAccessCidrs: c.resourcesVpcConfig?.publicAccessCidrs ?? [],
            vpcId: c.resourcesVpcConfig?.vpcId ?? null,
            createdAt: iso(c.createdAt),
          },
        });
      }
      return out;
    }),
};

export const ecrCollector: Collector = {
  id: "ecr:repositories",
  resourceTypes: [RESOURCE_TYPES.ECR_REPOSITORY],
  scope: "regional",
  iamAction: "ecr:DescribeRepositories",
  collect: (ctx) =>
    using(createAwsClient(ECRClient, ctx.session, ctx.region, "ecr"), async (ecr) => {
      const repos = await paginate((nextToken) => ecr.send(new DescribeRepositoriesCommand({ nextToken, maxResults: 100 })), (p) => ({ items: p.repositories, nextToken: p.nextToken }));
      const settled = await mapSettledLimit(repos.filter((r) => r.repositoryName), 4, async (r): Promise<NormalizedResource<EcrRepositoryAttrs>> => {
        const images = await observe(() =>
          paginate((nextToken) => ecr.send(new DescribeImagesCommand({ repositoryName: r.repositoryName, nextToken, maxResults: 1000 })), (p) => ({ items: p.imageDetails, nextToken: p.nextToken }), { maxPages: 20 }),
        );
        const latest = images.ok ? [...images.value].sort((a, b) => (b.imagePushedAt?.getTime() ?? 0) - (a.imagePushedAt?.getTime() ?? 0))[0] : undefined;
        const counts = latest?.imageScanFindingsSummary?.findingSeverityCounts;
        return {
          resourceType: RESOURCE_TYPES.ECR_REPOSITORY,
          region: ctx.region,
          resourceId: r.repositoryName!,
          arn: r.repositoryArn ?? null,
          name: r.repositoryName!,
          state: null,
          tags: {},
          attributes: {
            imageCount: images.ok ? images.value.length : null,
            scanOnPush: Boolean(r.imageScanningConfiguration?.scanOnPush),
            tagMutability: r.imageTagMutability ?? null,
            encryptionType: r.encryptionConfiguration?.encryptionType ?? null,
            latestScan: counts ? { critical: counts.CRITICAL ?? 0, high: counts.HIGH ?? 0 } : null,
            createdAt: iso(r.createdAt),
          },
        };
      });
      return allOrThrow(settled);
    }),
};

// ─────────────────────────── Load balancing & edge ───────────────────────────

export const elbCollector: Collector = {
  id: "elbv2:load-balancers",
  resourceTypes: [RESOURCE_TYPES.LOAD_BALANCER],
  scope: "regional",
  iamAction: "elasticloadbalancing:DescribeLoadBalancers",
  collect: (ctx) =>
    using(createAwsClient(ElasticLoadBalancingV2Client, ctx.session, ctx.region, "elbv2"), async (elb) => {
      const lbs = await paginate((Marker) => elb.send(new DescribeLoadBalancersCommand({ Marker, PageSize: 400 })), (p) => ({ items: p.LoadBalancers, nextToken: p.NextMarker }));
      const tagMap = new Map<string, Record<string, string>>();
      for (const batch of chunk(lbs.map((l) => l.LoadBalancerArn).filter((x): x is string => Boolean(x)), 20)) {
        const tags = await observe(async () => (await elb.send(new DescribeTagsCommand({ ResourceArns: batch }))).TagDescriptions ?? []);
        if (tags.ok) for (const t of tags.value) if (t.ResourceArn) tagMap.set(t.ResourceArn, tagsToRecord(t.Tags));
      }
      return lbs
        .filter((l) => l.LoadBalancerName && l.LoadBalancerArn)
        .map((l): NormalizedResource<LoadBalancerAttrs> => ({
          resourceType: RESOURCE_TYPES.LOAD_BALANCER,
          region: ctx.region,
          resourceId: l.LoadBalancerName!,
          arn: l.LoadBalancerArn!,
          name: l.LoadBalancerName!,
          state: l.State?.Code ?? null,
          tags: tagMap.get(l.LoadBalancerArn!) ?? {},
          attributes: {
            lbType: l.Type ?? "unknown",
            scheme: l.Scheme ?? null,
            dnsName: l.DNSName ?? null,
            vpcId: l.VpcId ?? null,
            subnetIds: (l.AvailabilityZones ?? []).map((z) => z.SubnetId).filter((x): x is string => Boolean(x)),
            securityGroupIds: l.SecurityGroups ?? [],
            createdAt: iso(l.CreatedTime),
          },
          searchTerms: l.DNSName ? [l.DNSName] : [],
        }));
    }),
};

function globalCtx(ctx: CollectorContext) {
  return globalRegionFor(ctx.session.partition);
}

export const cloudfrontCollector: Collector = {
  id: "cloudfront:distributions",
  resourceTypes: [RESOURCE_TYPES.CLOUDFRONT_DISTRIBUTION],
  scope: "global",
  iamAction: "cloudfront:ListDistributions",
  collect: (ctx) =>
    using(createAwsClient(CloudFrontClient, ctx.session, globalCtx(ctx), "cloudfront"), async (cf) => {
      const items = await paginate(
        (Marker) => cf.send(new ListDistributionsCommand({ Marker, MaxItems: 100 })),
        (p) => ({ items: p.DistributionList?.Items, nextToken: p.DistributionList?.IsTruncated ? p.DistributionList.NextMarker : undefined }),
      );
      return items
        .filter((d) => d.Id)
        .map((d) => ({
          resourceType: RESOURCE_TYPES.CLOUDFRONT_DISTRIBUTION,
          region: GLOBAL_REGION,
          resourceId: d.Id!,
          arn: d.ARN ?? null,
          name: d.Aliases?.Items?.[0] ?? d.DomainName ?? d.Id!,
          state: d.Enabled ? (d.Status ?? "Enabled") : "Disabled",
          tags: {},
          attributes: { domainName: d.DomainName ?? null, aliases: d.Aliases?.Items ?? [], enabled: Boolean(d.Enabled) },
          searchTerms: [d.DomainName ?? "", ...(d.Aliases?.Items ?? [])],
        }));
    }),
};

export const route53Collector: Collector = {
  id: "route53:zones",
  resourceTypes: [RESOURCE_TYPES.ROUTE53_ZONE],
  scope: "global",
  iamAction: "route53:ListHostedZones",
  collect: (ctx) =>
    using(createAwsClient(Route53Client, ctx.session, globalCtx(ctx), "route53"), async (r53) => {
      const zones = await paginate(
        (Marker) => r53.send(new ListHostedZonesCommand({ Marker, MaxItems: 100 })),
        (p) => ({ items: p.HostedZones, nextToken: p.IsTruncated ? p.NextMarker : undefined }),
      );
      return zones
        .filter((z) => z.Id)
        .map((z) => ({
          resourceType: RESOURCE_TYPES.ROUTE53_ZONE,
          region: GLOBAL_REGION,
          resourceId: z.Id!.replace("/hostedzone/", ""),
          arn: `arn:aws:route53:::hostedzone/${z.Id!.replace("/hostedzone/", "")}`,
          name: z.Name ?? null,
          state: null,
          tags: {},
          attributes: { privateZone: Boolean(z.Config?.PrivateZone), recordCount: z.ResourceRecordSetCount ?? 0 },
        }));
    }),
};

export const apiGatewayCollector: Collector = {
  id: "apigateway:apis",
  resourceTypes: [RESOURCE_TYPES.APIGW_REST_API, RESOURCE_TYPES.APIGW_HTTP_API],
  scope: "regional",
  iamAction: "apigateway:GET",
  async collect(ctx) {
    const [rest, http] = await Promise.all([
      using(createAwsClient(APIGatewayClient, ctx.session, ctx.region, "apigateway"), (c) =>
        paginate((position) => c.send(new GetRestApisCommand({ position, limit: 500 })), (p) => ({ items: p.items, nextToken: p.position })),
      ),
      using(createAwsClient(ApiGatewayV2Client, ctx.session, ctx.region, "apigatewayv2"), (c) =>
        paginate((NextToken) => c.send(new GetApisCommand({ NextToken, MaxResults: "500" })), (p) => ({ items: p.Items, nextToken: p.NextToken })),
      ),
    ]);
    return [
      ...rest.filter((a) => a.id).map((a) => ({ resourceType: RESOURCE_TYPES.APIGW_REST_API, region: ctx.region, resourceId: a.id!, arn: `arn:aws:apigateway:${ctx.region}::/restapis/${a.id}`, name: a.name ?? null, state: null, tags: tagsToRecord(a.tags), attributes: { endpointTypes: a.endpointConfiguration?.types ?? [], createdAt: iso(a.createdDate) } })),
      ...http.filter((a) => a.ApiId).map((a) => ({ resourceType: RESOURCE_TYPES.APIGW_HTTP_API, region: ctx.region, resourceId: a.ApiId!, arn: `arn:aws:apigateway:${ctx.region}::/apis/${a.ApiId}`, name: a.Name ?? null, state: null, tags: tagsToRecord(a.Tags), attributes: { protocol: a.ProtocolType ?? null, endpoint: a.ApiEndpoint ?? null, createdAt: iso(a.CreatedDate) } })),
    ];
  },
};

// ─────────────────────────── Messaging ───────────────────────────

export const snsCollector: Collector = {
  id: "sns:topics",
  resourceTypes: [RESOURCE_TYPES.SNS_TOPIC],
  scope: "regional",
  iamAction: "sns:ListTopics",
  collect: (ctx) =>
    using(createAwsClient(SNSClient, ctx.session, ctx.region, "sns"), async (sns) => {
      const topics = await paginate((NextToken) => sns.send(new ListTopicsCommand({ NextToken })), (p) => ({ items: p.Topics, nextToken: p.NextToken }));
      return topics
        .filter((t) => t.TopicArn)
        .map((t) => ({ resourceType: RESOURCE_TYPES.SNS_TOPIC, region: ctx.region, resourceId: t.TopicArn!.split(":").pop()!, arn: t.TopicArn!, name: t.TopicArn!.split(":").pop()!, state: null, tags: {}, attributes: {} }));
    }),
};

export const sqsCollector: Collector = {
  id: "sqs:queues",
  resourceTypes: [RESOURCE_TYPES.SQS_QUEUE],
  scope: "regional",
  iamAction: "sqs:ListQueues",
  collect: (ctx) =>
    // useQueueUrlAsEndpoint=false: requests go to the regional AWS endpoint, never to a host
    // taken from a response value.
    using(createAwsClient(SQSClient, ctx.session, ctx.region, "sqs", { useQueueUrlAsEndpoint: false }), async (sqs) => {
      const urls = await paginate((NextToken) => sqs.send(new ListQueuesCommand({ NextToken, MaxResults: 1000 })), (p) => ({ items: p.QueueUrls, nextToken: p.NextToken }));
      const settled = await mapSettledLimit(urls, 5, async (QueueUrl): Promise<NormalizedResource> => {
        const attrs = await observe(async () => (await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["SqsManagedSseEnabled", "KmsMasterKeyId"] }))).Attributes ?? {});
        const name = QueueUrl.split("/").pop() ?? QueueUrl;
        const a = attrs.ok ? attrs.value : undefined;
        return {
          resourceType: RESOURCE_TYPES.SQS_QUEUE,
          region: ctx.region,
          resourceId: name,
          arn: `arn:aws:sqs:${ctx.region}:${ctx.accountId}:${name}`,
          name,
          state: null,
          tags: {},
          attributes: { encryption: a ? (a.KmsMasterKeyId ? "SSE-KMS" : a.SqsManagedSseEnabled === "true" ? "SSE-SQS" : "none") : "unknown" },
        };
      });
      return allOrThrow(settled);
    }),
};

export const EXTRA_COLLECTORS: readonly Collector[] = [
  rdsCollector,
  dynamoCollector,
  lambdaCollector,
  ecsCollector,
  eksCollector,
  ecrCollector,
  elbCollector,
  apiGatewayCollector,
  snsCollector,
  sqsCollector,
  cloudfrontCollector,
  route53Collector,
];

