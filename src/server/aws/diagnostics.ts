import "server-only";
import { DescribeTrailsCommand, CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { CloudWatchClient, ListMetricsCommand } from "@aws-sdk/client-cloudwatch";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVpcsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient, ListClustersCommand } from "@aws-sdk/client-ecs";
import { EKSClient, ListClustersCommand as ListEksClustersCommand } from "@aws-sdk/client-eks";
import { DescribeRepositoriesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { GuardDutyClient, ListDetectorsCommand } from "@aws-sdk/client-guardduty";
import { GetAccountSummaryCommand, IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { DescribeHubCommand, SecurityHubClient } from "@aws-sdk/client-securityhub";
import { mapSettledLimit } from "./concurrency";
import { createAwsClient } from "./client-factory";
import { describeAwsFailure } from "./aws-failure";
import type { Capability } from "./permissions";
import { globalRegionFor } from "./regions-catalog";
import type { AwsSession } from "./session";

export type ProbeStatus = "OK" | "DENIED" | "NOT_ENABLED" | "ERROR";

export interface ProbeResult {
  capability: Capability;
  label: string;
  iamAction: string;
  required: boolean;
  status: ProbeStatus;
  /** Sanitised hint for the UI; never raw AWS messages. */
  message?: string;
}

interface Probe {
  capability: Capability;
  label: string;
  iamAction: string;
  required: boolean;
  /** Probes that incur AWS charges are skipped unless explicitly requested. */
  billed?: boolean;
  run(session: AwsSession, region: string): Promise<void>;
}

/** Destroys the client after a single call. */
async function once<C extends { destroy(): void; send: (c: never) => Promise<unknown> }>(client: C, cmd: unknown) {
  try {
    await client.send(cmd as never);
  } finally {
    client.destroy();
  }
}

const PROBES: Probe[] = [
  { capability: "ec2", label: "EC2 instances", iamAction: "ec2:DescribeInstances", required: true, run: (s, r) => once(createAwsClient(EC2Client, s, r, "ec2"), new DescribeInstancesCommand({ MaxResults: 5 })) },
  { capability: "vpc", label: "VPC networking", iamAction: "ec2:DescribeVpcs", required: true, run: (s, r) => once(createAwsClient(EC2Client, s, r, "ec2"), new DescribeVpcsCommand({ MaxResults: 5 })) },
  { capability: "vpc", label: "Security groups", iamAction: "ec2:DescribeSecurityGroups", required: true, run: (s, r) => once(createAwsClient(EC2Client, s, r, "ec2"), new DescribeSecurityGroupsCommand({ MaxResults: 5 })) },
  { capability: "s3", label: "S3 buckets", iamAction: "s3:ListAllMyBuckets", required: true, run: (s) => once(createAwsClient(S3Client, s, globalRegionFor(s.partition), "s3"), new ListBucketsCommand({ MaxBuckets: 1 })) },
  { capability: "rds", label: "RDS databases", iamAction: "rds:DescribeDBInstances", required: false, run: (s, r) => once(createAwsClient(RDSClient, s, r, "rds"), new DescribeDBInstancesCommand({ MaxRecords: 20 })) },
  { capability: "dynamodb", label: "DynamoDB tables", iamAction: "dynamodb:ListTables", required: false, run: (s, r) => once(createAwsClient(DynamoDBClient, s, r, "dynamodb"), new ListTablesCommand({ Limit: 1 })) },
  { capability: "lambda", label: "Lambda functions", iamAction: "lambda:ListFunctions", required: false, run: (s, r) => once(createAwsClient(LambdaClient, s, r, "lambda"), new ListFunctionsCommand({ MaxItems: 1 })) },
  { capability: "ecs", label: "ECS clusters", iamAction: "ecs:ListClusters", required: false, run: (s, r) => once(createAwsClient(ECSClient, s, r, "ecs"), new ListClustersCommand({ maxResults: 1 })) },
  { capability: "eks", label: "EKS clusters", iamAction: "eks:ListClusters", required: false, run: (s, r) => once(createAwsClient(EKSClient, s, r, "eks"), new ListEksClustersCommand({ maxResults: 1 })) },
  { capability: "ecr", label: "ECR repositories", iamAction: "ecr:DescribeRepositories", required: false, run: (s, r) => once(createAwsClient(ECRClient, s, r, "ecr"), new DescribeRepositoriesCommand({ maxResults: 1 })) },
  { capability: "elb", label: "Load balancers", iamAction: "elasticloadbalancing:DescribeLoadBalancers", required: false, run: (s, r) => once(createAwsClient(ElasticLoadBalancingV2Client, s, r, "elbv2"), new DescribeLoadBalancersCommand({ PageSize: 1 })) },
  { capability: "iam", label: "IAM security metadata", iamAction: "iam:GetAccountSummary", required: false, run: (s) => once(createAwsClient(IAMClient, s, globalRegionFor(s.partition), "iam"), new GetAccountSummaryCommand({})) },
  { capability: "cloudwatch", label: "CloudWatch metrics", iamAction: "cloudwatch:ListMetrics", required: false, run: (s, r) => once(createAwsClient(CloudWatchClient, s, r, "cloudwatch"), new ListMetricsCommand({ Namespace: "AWS/EC2", MetricName: "CPUUtilization" })) },
  { capability: "cloudtrail", label: "CloudTrail", iamAction: "cloudtrail:DescribeTrails", required: false, run: (s, r) => once(createAwsClient(CloudTrailClient, s, r, "cloudtrail"), new DescribeTrailsCommand({})) },
  { capability: "guardduty", label: "GuardDuty", iamAction: "guardduty:ListDetectors", required: false, run: (s, r) => once(createAwsClient(GuardDutyClient, s, r, "guardduty"), new ListDetectorsCommand({ MaxResults: 1 })) },
  { capability: "securityhub", label: "Security Hub", iamAction: "securityhub:DescribeHub", required: false, run: (s, r) => once(createAwsClient(SecurityHubClient, s, r, "securityhub"), new DescribeHubCommand({})) },
  {
    capability: "cost",
    label: "Cost Explorer",
    iamAction: "ce:GetCostAndUsage",
    required: false,
    billed: true,
    run: (s) => {
      const end = new Date();
      const start = new Date(end.getTime() - 86_400_000);
      const d = (x: Date) => x.toISOString().slice(0, 10);
      return once(
        createAwsClient(CostExplorerClient, s, globalRegionFor(s.partition), "ce"),
        new GetCostAndUsageCommand({ TimePeriod: { Start: d(start), End: d(end) }, Granularity: "DAILY", Metrics: ["UnblendedCost"] }),
      );
    },
  },
];

export interface DiagnosticsSummary {
  probes: ProbeResult[];
  requiredOk: boolean;
  optionalIssues: number;
  checkedAt: string;
}

/**
 * Runs one cheap read per capability in a single region. Distinguishes "permission denied"
 * (actionable: shows the missing IAM action) from "service not enabled" (informational).
 */
export async function runDiagnostics(session: AwsSession, region: string, opts: { includeBilled?: boolean } = {}): Promise<DiagnosticsSummary> {
  const probes = PROBES.filter((p) => opts.includeBilled !== false || !p.billed);
  const settled = await mapSettledLimit(probes, 4, (p) => p.run(session, region));
  const results: ProbeResult[] = probes.map((p, i) => {
    const s = settled[i]!;
    if (s.status === "fulfilled") return { capability: p.capability, label: p.label, iamAction: p.iamAction, required: p.required, status: "OK" };
    // AWS returns AccessDeniedException both for a missing permission and for a service that is
    // not enabled for the account — those need different fixes, so classify by AWS's own wording.
    const failure = describeAwsFailure(s.reason, p.iamAction);
    const status: ProbeStatus =
      failure.reason === "service_not_enabled" ? "NOT_ENABLED" : failure.reason === "permission_denied" || failure.reason === "explicit_deny" || failure.reason === "scp_denied" ? "DENIED" : "ERROR";
    return { capability: p.capability, label: p.label, iamAction: p.iamAction, required: p.required, status, message: `${failure.message} ${failure.remediation}`.trim() };
  });
  return {
    probes: results,
    requiredOk: results.every((r) => !r.required || r.status === "OK"),
    optionalIssues: results.filter((r) => !r.required && (r.status === "DENIED" || r.status === "ERROR")).length,
    checkedAt: new Date().toISOString(),
  };
}
