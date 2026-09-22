# Security Center

Security scans run in the inventory worker after successful or partial inventory collection. The `/security` page reads persisted findings; it does not call AWS from the browser. Existing accounts need another inventory sync after upgrading.

## Setup

Apply the migration with `npm run db:migrate`, regenerate Prisma with `npm run db:generate`, and rebuild/restart the web and worker processes. The migration adds nullable `securityScannedAt` and `securityCoverage` fields to AWS account metadata. Existing rows remain intact.

The generated read-only onboarding policy includes the required IAM, CloudTrail, GuardDuty and Security Hub reads. Existing customer roles must include `guardduty:GetDetector` to distinguish enabled from suspended detectors. Missing reads appear as coverage gaps.

## Findings

- Inventory rules inspect supported S3, security group, EBS, RDS, DynamoDB, EKS, ECR, Lambda and SQS configuration.
- Account checks inspect root MFA/key metadata, password-policy presence, old IAM access-key metadata, multi-region trail logging and GuardDuty enablement.
- GuardDuty and Security Hub findings are imported with pagination and bounded limits. Collection errors are not treated as empty results.
- The database fingerprint includes account, source, rule and subject. Repeated scans update the same finding.
- Each finding explains the detected configuration, its significance, evidence, and investigation/remediation steps.
- Confirmed recurrence reopens resolved findings. Suppressed findings remain suppressed until an authorized member reopens them.
- Failed or stale inventory checks cannot resolve resource findings. Unknown observed fields conservatively prevent resolution for that resource.
- Unavailable account checks and incomplete external imports cannot resolve prior findings. Disabling a security service does not resolve its old findings.
- Findings for deleted resources are conservatively retained; automatic resolution on deletion is not implemented.

## Authorization and exports

`security:read` protects queries and the page. `security:manage` protects suppression/reopening; a reason is required and recorded in the audit log. Users cannot manually mark a finding resolved. CSV exports require both `security:read` and `reports:export`, use the page filters, enforce tenant scope, and escape spreadsheet formulas. No AWS mutation is performed.

## Interpretation and limits

Coverage describes checks that ran, not a comprehensive security certification. Scans use configuration metadata; security-group ingress alone does not establish internet reachability. ECR repository scan-on-push settings do not establish whether registry-level enhanced scanning is enabled. Lambda runtime rules contain a conservative static legacy list and require periodic maintenance. CloudTrail checks do not assess all event-selector or CloudTrail Lake configurations.

No unencrypted-object claim is inferred from a missing S3 default encryption configuration. AWS automatically encrypts new S3 uploads; existing-object posture requires object-level evidence not collected here. See [AWS default encryption documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html).

Scan persistence is batched, so a failed scan may leave some freshly updated findings alongside older ones. The scan timestamp/coverage is updated only on completion. Previous findings remain available. External imports are bounded to 10,000 findings per source/region; exceeding the bound is unavailable coverage, not a clean account.
