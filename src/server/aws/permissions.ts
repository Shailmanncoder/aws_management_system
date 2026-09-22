/**
 * Single source of truth for every AWS permission Stratus uses and WHY.
 * The CloudFormation template, manual IAM policy, diagnostics and docs/IAM.md are all derived
 * from this catalogue. Read permissions and mutation permissions are strictly separated.
 */

export type Capability =
  | "regions"
  | "ec2"
  | "vpc"
  | "s3"
  | "rds"
  | "dynamodb"
  | "lambda"
  | "ecs"
  | "eks"
  | "ecr"
  | "elb"
  | "cloudfront"
  | "route53"
  | "apigateway"
  | "sns"
  | "sqs"
  | "iam"
  | "cloudwatch"
  | "cost"
  | "cloudtrail"
  | "guardduty"
  | "securityhub"
  | "resourceexplorer"
  | "pricing";

export interface PermissionEntry {
  action: string;
  capability: Capability;
  reason: string;
}

export const READ_PERMISSIONS: readonly PermissionEntry[] = [
  { action: "ec2:DescribeRegions", capability: "regions", reason: "Discover which regions are enabled so every region is scanned." },

  { action: "ec2:DescribeInstances", capability: "ec2", reason: "EC2 inventory (state, type, networking, tags)." },
  { action: "ec2:DescribeVolumes", capability: "ec2", reason: "EBS volumes: encryption, attachment state (unattached-volume findings)." },
  { action: "ec2:DescribeSnapshots", capability: "ec2", reason: "Owned EBS snapshots: age-based optimisation findings." },
  { action: "ec2:DescribeAddresses", capability: "ec2", reason: "Elastic IPs: unassociated-address findings." },

  { action: "ec2:DescribeVpcs", capability: "vpc", reason: "Network explorer." },
  { action: "ec2:DescribeSubnets", capability: "vpc", reason: "Network explorer." },
  { action: "ec2:DescribeRouteTables", capability: "vpc", reason: "Network explorer: routes to IGW/NAT." },
  { action: "ec2:DescribeInternetGateways", capability: "vpc", reason: "Network explorer." },
  { action: "ec2:DescribeNatGateways", capability: "vpc", reason: "Network explorer." },
  { action: "ec2:DescribeSecurityGroups", capability: "vpc", reason: "Network explorer and security-group exposure findings." },
  { action: "ec2:DescribeNetworkAcls", capability: "vpc", reason: "Network explorer." },
  { action: "ec2:DescribeVpcEndpoints", capability: "vpc", reason: "Network explorer." },

  { action: "s3:ListAllMyBuckets", capability: "s3", reason: "S3 bucket inventory." },
  { action: "s3:GetBucketLocation", capability: "s3", reason: "Resolve bucket region." },
  { action: "s3:GetEncryptionConfiguration", capability: "s3", reason: "Default encryption posture." },
  { action: "s3:GetBucketVersioning", capability: "s3", reason: "Versioning posture." },
  { action: "s3:GetBucketPublicAccessBlock", capability: "s3", reason: "Public-access-block posture (one of several exposure signals)." },
  { action: "s3:GetAccountPublicAccessBlock", capability: "s3", reason: "Account-level public-access-block (overrides bucket settings)." },
  { action: "s3:GetBucketPolicyStatus", capability: "s3", reason: "AWS's own evaluation of whether the bucket policy is public." },
  { action: "s3:GetBucketAcl", capability: "s3", reason: "Detect public ACL grants." },
  { action: "s3:GetBucketLogging", capability: "s3", reason: "Access-logging posture." },
  { action: "s3:GetLifecycleConfiguration", capability: "s3", reason: "Lifecycle-rule optimisation findings." },
  { action: "s3:GetBucketTagging", capability: "s3", reason: "Tags for search/filtering." },

  { action: "rds:DescribeDBInstances", capability: "rds", reason: "RDS inventory: engine, class, encryption, public accessibility, backups." },
  { action: "rds:DescribeDBClusters", capability: "rds", reason: "Aurora cluster inventory." },

  { action: "dynamodb:ListTables", capability: "dynamodb", reason: "DynamoDB inventory." },
  { action: "dynamodb:DescribeTable", capability: "dynamodb", reason: "Table capacity mode, size, encryption (metadata only — never item data)." },
  { action: "dynamodb:DescribeContinuousBackups", capability: "dynamodb", reason: "Point-in-time-recovery posture." },

  { action: "lambda:ListFunctions", capability: "lambda", reason: "Lambda inventory. Environment variables in the response are discarded, never stored." },
  { action: "lambda:ListTags", capability: "lambda", reason: "Tags for search/filtering." },

  { action: "ecs:ListClusters", capability: "ecs", reason: "ECS inventory." },
  { action: "ecs:DescribeClusters", capability: "ecs", reason: "ECS cluster status/counts." },
  { action: "ecs:ListServices", capability: "ecs", reason: "ECS services." },
  { action: "ecs:DescribeServices", capability: "ecs", reason: "Service desired/running counts, launch type." },
  { action: "ecs:ListTasks", capability: "ecs", reason: "Running task counts." },

  { action: "eks:ListClusters", capability: "eks", reason: "EKS inventory." },
  { action: "eks:DescribeCluster", capability: "eks", reason: "Version, status and endpoint public/private access configuration." },

  { action: "ecr:DescribeRepositories", capability: "ecr", reason: "ECR inventory, scan-on-push and encryption settings." },
  { action: "ecr:DescribeImages", capability: "ecr", reason: "Image counts and scan summary (metadata only; images are never pulled)." },

  { action: "elasticloadbalancing:DescribeLoadBalancers", capability: "elb", reason: "ALB/NLB/CLB inventory and scheme (internet-facing/internal)." },
  { action: "elasticloadbalancing:DescribeTags", capability: "elb", reason: "Tags for search/filtering." },

  { action: "cloudfront:ListDistributions", capability: "cloudfront", reason: "CloudFront inventory." },
  { action: "route53:ListHostedZones", capability: "route53", reason: "Route 53 hosted-zone inventory (record values are not read)." },
  { action: "apigateway:GET", capability: "apigateway", reason: "API Gateway REST/HTTP API inventory (restricted by resource to /restapis and /apis)." },
  { action: "sns:ListTopics", capability: "sns", reason: "SNS inventory." },
  { action: "sqs:ListQueues", capability: "sqs", reason: "SQS inventory." },
  { action: "sqs:GetQueueAttributes", capability: "sqs", reason: "Queue encryption posture (messages are never read)." },

  { action: "iam:GetAccountSummary", capability: "iam", reason: "Root-account MFA and access-key presence (security posture)." },
  { action: "iam:GetAccountPasswordPolicy", capability: "iam", reason: "Password-policy posture." },
  { action: "iam:ListUsers", capability: "iam", reason: "IAM user metadata for access-key age checks." },
  { action: "iam:ListAccessKeys", capability: "iam", reason: "Access-key age/status metadata only (secrets are never retrievable)." },

  { action: "cloudwatch:GetMetricData", capability: "cloudwatch", reason: "Monitoring graphs and utilisation signals." },
  { action: "cloudwatch:ListMetrics", capability: "cloudwatch", reason: "Determine which metrics exist before querying." },

  { action: "invoicing:ListInvoiceSummaries", capability: "cost", reason: "Read invoice totals in the actual payment currency; no payment instrument details." },
  { action: "ce:GetCostAndUsage", capability: "cost", reason: "Cost Explorer spend by day/month/service/region/account. Note: AWS bills each request." },

  { action: "cloudtrail:DescribeTrails", capability: "cloudtrail", reason: "CloudTrail configuration posture." },
  { action: "cloudtrail:GetTrailStatus", capability: "cloudtrail", reason: "Whether trails are actively logging." },

  { action: "guardduty:ListDetectors", capability: "guardduty", reason: "Whether GuardDuty is enabled." },
  { action: "guardduty:GetDetector", capability: "guardduty", reason: "Distinguish enabled detectors from suspended GuardDuty protection." },
  { action: "guardduty:ListFindings", capability: "guardduty", reason: "Import GuardDuty findings." },
  { action: "guardduty:GetFindings", capability: "guardduty", reason: "Import GuardDuty findings." },

  { action: "securityhub:DescribeHub", capability: "securityhub", reason: "Whether Security Hub is enabled." },
  { action: "securityhub:GetFindings", capability: "securityhub", reason: "Import Security Hub findings." },

  { action: "pricing:GetProducts", capability: "pricing", reason: "Public AWS on-demand list prices, used only to estimate optimisation savings (no account data)." },
  { action: "resource-explorer-2:Search", capability: "resourceexplorer", reason: "Optional: accelerate global search when Resource Explorer is configured." },
];

/**
 * Defence in depth: explicit DENY on data-plane reads and secret retrieval. Stratus never needs
 * object contents, secrets, parameters, item data, function code or instance passwords.
 */
export const DATA_PLANE_DENY: readonly string[] = [
  "s3:GetObject",
  "s3:GetObjectVersion",
  "secretsmanager:GetSecretValue",
  "ssm:GetParameter",
  "ssm:GetParameters",
  "ssm:GetParametersByPath",
  "kms:Decrypt",
  "dynamodb:GetItem",
  "dynamodb:BatchGetItem",
  "dynamodb:Query",
  "dynamodb:Scan",
  "lambda:GetFunction",
  "lambda:InvokeFunction",
  "ec2:GetPasswordData",
  "ec2:GetConsoleOutput",
  "ec2:DescribeInstanceAttribute",
  "logs:GetLogEvents",
  "logs:FilterLogEvents",
  "sqs:ReceiveMessage",
  "rds:DownloadDBLogFilePortion",
  "ecs:DescribeTaskDefinition",
];

/** Mutation permissions for the SEPARATE, optional action role. Never part of the read role. */
export const ACTION_PERMISSIONS: readonly (PermissionEntry & { destructive: boolean })[] = [
  { action: "ec2:StartInstances", capability: "ec2", reason: "Start a stopped instance on explicit user request.", destructive: false },
  { action: "ec2:StopInstances", capability: "ec2", reason: "Stop an instance on explicit user request (interrupts workloads).", destructive: true },
  { action: "ec2:RebootInstances", capability: "ec2", reason: "Reboot an instance on explicit user request (interrupts workloads).", destructive: true },
];

export function readActionsFor(capability: Capability): string[] {
  return READ_PERMISSIONS.filter((p) => p.capability === capability).map((p) => p.action);
}
