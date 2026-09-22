# AWS IAM permissions

> Generated from `src/server/aws/permissions.ts` — do not edit by hand (`npm run docs:gen`).

Stratus never requires `AdministratorAccess` (or even AWS's broad `ReadOnlyAccess`, which can read S3 objects).
The customer role grants **metadata reads only**, and explicitly **denies** data-plane and secret reads.

## Read-only role (`StratusReadOnlyRole`)

| Action | Capability | Why Stratus needs it |
|---|---|---|
| `ec2:DescribeRegions` | regions | Discover which regions are enabled so every region is scanned. |
| `ec2:DescribeInstances` | ec2 | EC2 inventory (state, type, networking, tags). |
| `ec2:DescribeVolumes` | ec2 | EBS volumes: encryption, attachment state (unattached-volume findings). |
| `ec2:DescribeSnapshots` | ec2 | Owned EBS snapshots: age-based optimisation findings. |
| `ec2:DescribeAddresses` | ec2 | Elastic IPs: unassociated-address findings. |
| `ec2:DescribeVpcs` | vpc | Network explorer. |
| `ec2:DescribeSubnets` | vpc | Network explorer. |
| `ec2:DescribeRouteTables` | vpc | Network explorer: routes to IGW/NAT. |
| `ec2:DescribeInternetGateways` | vpc | Network explorer. |
| `ec2:DescribeNatGateways` | vpc | Network explorer. |
| `ec2:DescribeSecurityGroups` | vpc | Network explorer and security-group exposure findings. |
| `ec2:DescribeNetworkAcls` | vpc | Network explorer. |
| `ec2:DescribeVpcEndpoints` | vpc | Network explorer. |
| `s3:ListAllMyBuckets` | s3 | S3 bucket inventory. |
| `s3:GetBucketLocation` | s3 | Resolve bucket region. |
| `s3:GetEncryptionConfiguration` | s3 | Default encryption posture. |
| `s3:GetBucketVersioning` | s3 | Versioning posture. |
| `s3:GetBucketPublicAccessBlock` | s3 | Public-access-block posture (one of several exposure signals). |
| `s3:GetAccountPublicAccessBlock` | s3 | Account-level public-access-block (overrides bucket settings). |
| `s3:GetBucketPolicyStatus` | s3 | AWS's own evaluation of whether the bucket policy is public. |
| `s3:GetBucketAcl` | s3 | Detect public ACL grants. |
| `s3:GetBucketLogging` | s3 | Access-logging posture. |
| `s3:GetLifecycleConfiguration` | s3 | Lifecycle-rule optimisation findings. |
| `s3:GetBucketTagging` | s3 | Tags for search/filtering. |
| `rds:DescribeDBInstances` | rds | RDS inventory: engine, class, encryption, public accessibility, backups. |
| `rds:DescribeDBClusters` | rds | Aurora cluster inventory. |
| `dynamodb:ListTables` | dynamodb | DynamoDB inventory. |
| `dynamodb:DescribeTable` | dynamodb | Table capacity mode, size, encryption (metadata only — never item data). |
| `dynamodb:DescribeContinuousBackups` | dynamodb | Point-in-time-recovery posture. |
| `lambda:ListFunctions` | lambda | Lambda inventory. Environment variables in the response are discarded, never stored. |
| `lambda:ListTags` | lambda | Tags for search/filtering. |
| `ecs:ListClusters` | ecs | ECS inventory. |
| `ecs:DescribeClusters` | ecs | ECS cluster status/counts. |
| `ecs:ListServices` | ecs | ECS services. |
| `ecs:DescribeServices` | ecs | Service desired/running counts, launch type. |
| `ecs:ListTasks` | ecs | Running task counts. |
| `eks:ListClusters` | eks | EKS inventory. |
| `eks:DescribeCluster` | eks | Version, status and endpoint public/private access configuration. |
| `ecr:DescribeRepositories` | ecr | ECR inventory, scan-on-push and encryption settings. |
| `ecr:DescribeImages` | ecr | Image counts and scan summary (metadata only; images are never pulled). |
| `elasticloadbalancing:DescribeLoadBalancers` | elb | ALB/NLB/CLB inventory and scheme (internet-facing/internal). |
| `elasticloadbalancing:DescribeTags` | elb | Tags for search/filtering. |
| `cloudfront:ListDistributions` | cloudfront | CloudFront inventory. |
| `route53:ListHostedZones` | route53 | Route 53 hosted-zone inventory (record values are not read). |
| `apigateway:GET` | apigateway | API Gateway REST/HTTP API inventory (restricted by resource to /restapis and /apis). |
| `sns:ListTopics` | sns | SNS inventory. |
| `sqs:ListQueues` | sqs | SQS inventory. |
| `sqs:GetQueueAttributes` | sqs | Queue encryption posture (messages are never read). |
| `iam:GetAccountSummary` | iam | Root-account MFA and access-key presence (security posture). |
| `iam:GetAccountPasswordPolicy` | iam | Password-policy posture. |
| `iam:ListUsers` | iam | IAM user metadata for access-key age checks. |
| `iam:ListAccessKeys` | iam | Access-key age/status metadata only (secrets are never retrievable). |
| `cloudwatch:GetMetricData` | cloudwatch | Monitoring graphs and utilisation signals. |
| `cloudwatch:ListMetrics` | cloudwatch | Determine which metrics exist before querying. |
| `invoicing:ListInvoiceSummaries` | cost | Read invoice totals in the actual payment currency; no payment instrument details. |
| `ce:GetCostAndUsage` | cost | Cost Explorer spend by day/month/service/region/account. Note: AWS bills each request. |
| `cloudtrail:DescribeTrails` | cloudtrail | CloudTrail configuration posture. |
| `cloudtrail:GetTrailStatus` | cloudtrail | Whether trails are actively logging. |
| `guardduty:ListDetectors` | guardduty | Whether GuardDuty is enabled. |
| `guardduty:GetDetector` | guardduty | Distinguish enabled detectors from suspended GuardDuty protection. |
| `guardduty:ListFindings` | guardduty | Import GuardDuty findings. |
| `guardduty:GetFindings` | guardduty | Import GuardDuty findings. |
| `securityhub:DescribeHub` | securityhub | Whether Security Hub is enabled. |
| `securityhub:GetFindings` | securityhub | Import Security Hub findings. |
| `pricing:GetProducts` | pricing | Public AWS on-demand list prices, used only to estimate optimisation savings (no account data). |
| `resource-explorer-2:Search` | resourceexplorer | Optional: accelerate global search when Resource Explorer is configured. |

## Explicit deny (defence in depth)

- `s3:GetObject`
- `s3:GetObjectVersion`
- `secretsmanager:GetSecretValue`
- `ssm:GetParameter`
- `ssm:GetParameters`
- `ssm:GetParametersByPath`
- `kms:Decrypt`
- `dynamodb:GetItem`
- `dynamodb:BatchGetItem`
- `dynamodb:Query`
- `dynamodb:Scan`
- `lambda:GetFunction`
- `lambda:InvokeFunction`
- `ec2:GetPasswordData`
- `ec2:GetConsoleOutput`
- `ec2:DescribeInstanceAttribute`
- `logs:GetLogEvents`
- `logs:FilterLogEvents`
- `sqs:ReceiveMessage`
- `rds:DownloadDBLogFilePortion`
- `ecs:DescribeTaskDefinition`

## Optional action role (`StratusActionRole`) — disabled by default

Deployed separately, only if a workspace owner enables operational actions. Restricted to EC2 instances
the customer tags `stratus:actions-allowed=true`.

| Action | Destructive | Why |
|---|---|---|
| `ec2:StartInstances` | no | Start a stopped instance on explicit user request. |
| `ec2:StopInstances` | yes | Stop an instance on explicit user request (interrupts workloads). |
| `ec2:RebootInstances` | yes | Reboot an instance on explicit user request (interrupts workloads). |

## Trust policy (per connection)

The role trusts only the Stratus platform principal, and only when the connection's unique ExternalId is presented:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowStratusWithExternalId",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<PLATFORM_ACCOUNT_ID>:role/<PLATFORM_ROLE>"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<UNIQUE_EXTERNAL_ID>"
        }
      }
    }
  ]
}
```

## Policy documents

<details><summary>Read-only policy</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StratusReadOnlyMetadata",
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "cloudfront:ListDistributions",
        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "cloudwatch:GetMetricData",
        "cloudwatch:ListMetrics",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:DescribeTable",
        "dynamodb:ListTables",
        "ec2:DescribeAddresses",
        "ec2:DescribeInstances",
        "ec2:DescribeInternetGateways",
        "ec2:DescribeNatGateways",
        "ec2:DescribeNetworkAcls",
        "ec2:DescribeRegions",
        "ec2:DescribeRouteTables",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSnapshots",
        "ec2:DescribeSubnets",
        "ec2:DescribeVolumes",
        "ec2:DescribeVpcEndpoints",
        "ec2:DescribeVpcs",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:ListTasks",
        "eks:DescribeCluster",
        "eks:ListClusters",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTags",
        "guardduty:GetDetector",
        "guardduty:GetFindings",
        "guardduty:ListDetectors",
        "guardduty:ListFindings",
        "iam:GetAccountPasswordPolicy",
        "iam:GetAccountSummary",
        "iam:ListAccessKeys",
        "iam:ListUsers",
        "invoicing:ListInvoiceSummaries",
        "lambda:ListFunctions",
        "lambda:ListTags",
        "pricing:GetProducts",
        "rds:DescribeDBClusters",
        "rds:DescribeDBInstances",
        "resource-explorer-2:Search",
        "route53:ListHostedZones",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketLocation",
        "s3:GetBucketLogging",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketTagging",
        "s3:GetBucketVersioning",
        "s3:GetEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:ListAllMyBuckets",
        "securityhub:DescribeHub",
        "securityhub:GetFindings",
        "sns:ListTopics",
        "sqs:GetQueueAttributes",
        "sqs:ListQueues"
      ],
      "Resource": "*"
    },
    {
      "Sid": "StratusApiGatewayInventory",
      "Effect": "Allow",
      "Action": "apigateway:GET",
      "Resource": [
        "arn:aws:apigateway:*::/restapis",
        "arn:aws:apigateway:*::/apis",
        "arn:aws:apigateway:*::/tags/*"
      ]
    }
  ]
}
```
</details>

<details><summary>Deny policy</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StratusDenyDataPlaneAndSecrets",
      "Effect": "Deny",
      "Action": [
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
        "ecs:DescribeTaskDefinition"
      ],
      "Resource": "*"
    }
  ]
}
```
</details>

<details><summary>Action policy (optional role)</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StratusTaggedInstanceActions",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/stratus:actions-allowed": "true"
        }
      }
    }
  ]
}
```
</details>

## Platform (Stratus's own) IAM role

The web and worker tasks run with a role that needs only:

- `sts:AssumeRole` on `arn:aws:iam::*:role/StratusReadOnlyRole` (and `StratusActionRole` if action mode is offered)
- `kms:GenerateDataKey` / `kms:Decrypt` on the Stratus envelope-encryption key, with an `kms:EncryptionContext:app = stratus` condition
- `secretsmanager:GetSecretValue` on the Stratus runtime secrets (via the ECS task definition)
- CloudWatch Logs write permissions (task execution role)
