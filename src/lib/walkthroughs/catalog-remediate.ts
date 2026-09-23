import type { Walkthrough } from "./types";

/**
 * One walkthrough per security finding Stratus can raise, mapped by rule id so a finding page can
 * link straight to the fix. Each one states what the change breaks as well as what it fixes,
 * because a remediation that takes an application down is not a successful remediation.
 *
 * `{{resourceId}}` resolves to the specific resource the finding was raised against.
 */

export const REMEDIATE_WALKTHROUGHS: Walkthrough[] = [
  {
    id: "fix-s3-public-access",
    title: "Make a public S3 bucket private",
    category: "remediate",
    summary: "Block public access on a bucket that is currently reachable by anyone on the internet.",
    fixesRuleIds: ["S3-PUBLIC", "S3-BPA-OFF"],
    estimatedMinutes: 5,
    steps: [
      {
        title: "Find out who is relying on it before you close it",
        where: ["Console", "S3", "Buckets", "{{resourceId}}", "Permissions"],
        target: { service: "s3", view: "bucketPermissions", resource: "{{resourceId}}" },
        actions: [
          "Open the bucket {{resourceId}} and select the Permissions tab.",
          "Read the Bucket policy and the Access control list (ACL) sections. Either one can make objects public.",
          "If the bucket serves a website or public downloads, closing it will break those immediately. Check CloudFront distributions and application configuration for references to this bucket first.",
        ],
        warning: "Blocking public access takes effect within seconds and applies to every object at once. If this bucket is genuinely serving public content, set up CloudFront with Origin Access Control before continuing.",
      },
      {
        title: "Turn Block Public Access on",
        where: ["Bucket", "Permissions", "Block public access (bucket settings)", "Edit"],
        actions: [
          "In the Block public access (bucket settings) panel, click Edit.",
          "Check Block all public access, which selects all four sub-settings.",
          "Click Save changes and type confirm when prompted.",
        ],
        fields: [
          { label: "Block all public access", value: "Checked", why: "The four settings block public ACLs, ignore existing public ACLs, block public bucket policies, and restrict access through any public policy that survives." },
        ],
      },
      {
        title: "Remove the public grant itself",
        actions: [
          "Still under Permissions, edit the Bucket policy and delete any statement whose Principal is \"*\" or {\"AWS\": \"*\"} without a restricting Condition.",
          "Under Object Ownership, click Edit and select ACLs disabled (recommended). This permanently stops object-level ACLs from granting access.",
        ],
        note: "Block Public Access overrides these grants while it is on, but removing them means the bucket is not one checkbox away from being public again.",
      },
      {
        title: "Close it at the account level too",
        where: ["Console", "S3", "Block Public Access settings for this account"],
        target: { service: "s3", view: "accountPublicAccess" },
        actions: [
          "In the S3 left sidebar, click Block Public Access settings for this account.",
          "Turn all four settings on if no bucket in the account legitimately needs to be public.",
        ],
        note: "This is the single most effective S3 control available: it makes it impossible for anyone to create a public bucket in the account by mistake.",
      },
    ],
    verify: [
      "The bucket list shows Access: Bucket and objects not public.",
      "Opening a known object URL in a private browser window returns AccessDenied.",
      "Re-run the Stratus sync; the S3-PUBLIC finding closes automatically on the next security analysis.",
    ],
    cli: {
      description: "The equivalent call. Run the read first to see what you are about to change.",
      commands: [
        "aws s3api get-public-access-block --bucket {{resourceId}}",
        "aws s3api put-public-access-block --bucket {{resourceId}} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
      ],
    },
    docs: [{ label: "Blocking public access to your S3 storage", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html" }],
  },

  {
    id: "fix-s3-versioning",
    title: "Enable versioning on an S3 bucket",
    category: "remediate",
    summary: "Make overwritten and deleted objects recoverable, and stop the old versions from billing forever.",
    fixesRuleIds: ["S3-VERSIONING"],
    estimatedMinutes: 5,
    steps: [
      {
        title: "Enable versioning",
        where: ["Console", "S3", "Buckets", "{{resourceId}}", "Properties"],
        target: { service: "s3", view: "bucketProperties", resource: "{{resourceId}}" },
        actions: [
          "Open the bucket {{resourceId}} and select the Properties tab.",
          "Find Bucket Versioning, near the top, and click Edit.",
          "Select Enable and click Save changes.",
        ],
        note: "Versioning applies from now on. Objects already overwritten before this change cannot be recovered.",
      },
      {
        title: "Add a lifecycle rule so old versions expire",
        where: ["Bucket", "Management", "Create lifecycle rule"],
        actions: [
          "Select the Management tab and click Create lifecycle rule.",
          "Name it expire-noncurrent-versions and choose Apply to all objects in the bucket, then acknowledge the warning.",
          "Check Permanently delete noncurrent versions of objects and set Days after objects become noncurrent to 30 (or 90 if you need a longer recovery window).",
          "Check Delete expired object delete markers and Delete incomplete multipart uploads after 7 days.",
          "Click Create rule.",
        ],
        warning: "Without this rule you pay full storage price for every version of every object indefinitely. This is a common and entirely invisible source of S3 cost growth.",
      },
    ],
    verify: ["Properties shows Bucket Versioning: Enabled.", "Management shows the lifecycle rule as Enabled."],
    rollback: "Versioning can be Suspended but never removed. Suspending stops new versions being created and keeps existing ones.",
    cli: {
      description: "Enable versioning from the CLI.",
      commands: ["aws s3api put-bucket-versioning --bucket {{resourceId}} --versioning-configuration Status=Enabled"],
    },
  },

  {
    id: "fix-s3-logging",
    title: "Turn on S3 access logging",
    category: "remediate",
    summary: "Record who read and wrote objects, so an incident can actually be investigated.",
    fixesRuleIds: ["S3-LOGGING"],
    estimatedMinutes: 10,
    steps: [
      {
        title: "Create a separate bucket for the logs",
        where: ["Console", "S3", "Buckets", "Create bucket"],
        target: { service: "s3", view: "buckets" },
        actions: [
          "Create a new bucket in the same region, named something like yourorg-s3-access-logs.",
          "Keep Block all public access on and enable default encryption.",
          "Add a lifecycle rule expiring objects after 90 days, or logs will grow without limit.",
        ],
        warning: "Never send a bucket's access logs to itself. Each log delivery is a write, which generates another log entry, which is another write.",
      },
      {
        title: "Point the source bucket at it",
        where: ["Console", "S3", "Buckets", "{{resourceId}}", "Properties", "Server access logging"],
        target: { service: "s3", view: "bucketProperties", resource: "{{resourceId}}" },
        actions: [
          "Open {{resourceId}}, select Properties, scroll to Server access logging and click Edit.",
          "Select Enable, then Browse S3 and choose the log bucket.",
          "Set a Target prefix such as {{resourceId}}/ so several buckets can share one log bucket.",
          "Click Save changes.",
        ],
        note: "Server access logs are delivered on a best-effort basis and can lag by hours. For an auditable, near-real-time record of object access, enable CloudTrail data events for the bucket instead, which is billed per event.",
      },
    ],
    verify: ["Properties shows Server access logging: Enabled.", "Log objects appear under the prefix within a few hours of activity."],
  },

  {
    id: "fix-security-group-open",
    title: "Close a security group that is open to the internet",
    category: "remediate",
    summary: "Replace a 0.0.0.0/0 inbound rule with one that names the actual source, without cutting off whoever is currently connected.",
    fixesRuleIds: ["SG-OPEN", "SG-WIDE"],
    estimatedMinutes: 10,
    steps: [
      {
        title: "Find out what is using the rule first",
        where: ["Console", "EC2", "Security Groups", "{{resourceId}}"],
        target: { service: "ec2", view: "securityGroup", resource: "{{resourceId}}" },
        actions: [
          "Open the security group {{resourceId}}.",
          "Check the Network interfaces tab, or the Instances filtered by this group, to see what it is attached to.",
          "If the open port is SSH (22) or RDP (3389), find out how people are actually connecting before removing it. Closing it while someone is mid-session does not drop that session, but it will stop the next one.",
        ],
        warning: "If you administer these instances over SSH from a changing home IP address and you remove the rule with no alternative in place, you will lock yourself out. Set up Systems Manager Session Manager first, or add your current address as a /32 before deleting the broad rule.",
      },
      {
        title: "Replace the rule",
        where: ["Security group", "Inbound rules", "Edit inbound rules"],
        actions: [
          "Select the Inbound rules tab and click Edit inbound rules.",
          "Find the rule whose Source is 0.0.0.0/0 or ::/0.",
          "Rather than deleting it immediately, click Add rule and create the narrow replacement first: same Type, with Source set to the calling resource's security group id, or My IP for a person.",
          "Click Save rules, confirm the application still works, then edit again and Delete the broad rule.",
        ],
        fields: [
          { label: "Source", value: "sg- of the caller, or your address as a /32", why: "A group reference keeps working when instances are replaced. My IP fills in your current address, which will change when your network does." },
        ],
        note: "Doing it in two passes means there is never a moment where neither rule allows the traffic.",
      },
      {
        title: "Remove the need for the port entirely",
        actions: [
          "For administrative access, attach the AmazonSSMManagedInstanceCore policy to the instance role and use Session Manager. It needs no inbound rule at all and logs every session.",
          "For web traffic, put an Application Load Balancer in the public subnet and allow port 443 only from the load balancer's security group to the instances.",
        ],
      },
    ],
    verify: [
      "The Inbound rules tab shows no source of 0.0.0.0/0 or ::/0 on an administrative or database port.",
      "The application still works from its legitimate source.",
      "After the next Stratus sync the SG-OPEN finding closes and the Network page shows an empty Internet-open column.",
    ],
    cli: {
      description: "Inspect, then revoke. Revoking takes effect immediately.",
      commands: [
        "aws ec2 describe-security-groups --region {{region}} --group-ids {{resourceId}} --query 'SecurityGroups[].IpPermissions'",
        "aws ec2 revoke-security-group-ingress --region {{region}} --group-id {{resourceId}} --protocol tcp --port 22 --cidr 0.0.0.0/0",
      ],
    },
  },

  {
    id: "fix-ebs-unencrypted",
    title: "Encrypt an existing EBS volume",
    category: "remediate",
    summary: "Encryption cannot be switched on in place, so this replaces the volume through an encrypted snapshot. It requires downtime.",
    fixesRuleIds: ["EBS-UNENCRYPTED", "SNAPSHOT-UNENCRYPTED"],
    estimatedMinutes: 30,
    prerequisites: ["A maintenance window: the instance must be stopped while the volume is swapped."],
    steps: [
      {
        title: "Stop the region from creating more unencrypted volumes",
        where: ["Console", "EC2", "EBS encryption"],
        target: { service: "ec2", view: "ebsEncryptionSettings" },
        actions: [
          "In the EC2 left sidebar, under Account attributes, click Data protection and security (older consoles call it EBS encryption).",
          "Click Manage and check Enable for Always encrypt new EBS volumes, then Update.",
        ],
        note: "This applies to new volumes in this region only. Repeat it in every region you use. It does not touch existing volumes, which is what the rest of this walkthrough is for.",
      },
      {
        title: "Snapshot the unencrypted volume",
        where: ["Console", "EC2", "Volumes"],
        target: { service: "ec2", view: "volume", resource: "{{resourceId}}" },
        actions: [
          "Open Volumes, select {{resourceId}}, then Actions and Create snapshot.",
          "Give it a description that identifies the source volume and wait for its status to become Completed.",
        ],
      },
      {
        title: "Copy the snapshot with encryption enabled",
        where: ["Console", "EC2", "Snapshots"],
        target: { service: "ec2", view: "snapshots" },
        actions: [
          "Select the new snapshot, then Actions and Copy snapshot.",
          "Keep the destination region the same, check Encrypt this snapshot, and leave the default aws/ebs KMS key selected.",
          "Click Copy snapshot and wait for the copy to complete.",
        ],
        note: "Copying is the only way to add encryption: a snapshot's encryption state is fixed when it is created, exactly as a volume's is.",
      },
      {
        title: "Create the encrypted volume and swap it in",
        actions: [
          "Select the encrypted snapshot, then Actions and Create volume from snapshot. Choose the same Availability Zone as the instance, or it cannot be attached.",
          "Stop the instance. Note the device name of the old volume on the instance's Storage tab (usually /dev/xvda for the root volume).",
          "Detach the old volume, attach the new encrypted one using exactly the same device name, and start the instance.",
        ],
        warning: "The device name must match, particularly for a root volume. Attaching a root volume as /dev/sdf will leave the instance unable to boot.",
      },
      {
        title: "Clean up",
        actions: [
          "Confirm the instance boots and the data is intact before deleting anything.",
          "Delete the unencrypted snapshot and, once you are confident, the old unencrypted volume. Both continue to bill until deleted.",
        ],
      },
    ],
    verify: [
      "The Volumes list shows Encryption: Encrypted for the new volume.",
      "The instance passes both status checks and the application starts.",
      "The EBS-UNENCRYPTED finding closes after the next sync.",
    ],
    rollback: "Keep the original volume until you are satisfied. Reversing is the same swap in the other direction.",
  },

  {
    id: "fix-rds-public",
    title: "Remove public access from an RDS database",
    category: "remediate",
    summary: "Take the database's public IP away so it is only reachable from inside the VPC.",
    fixesRuleIds: ["RDS-PUBLIC"],
    estimatedMinutes: 10,
    steps: [
      {
        title: "Check what connects to it over the internet",
        where: ["Console", "RDS", "Databases", "{{resourceId}}", "Connectivity and security"],
        target: { service: "rds", view: "database", resource: "{{resourceId}}" },
        actions: [
          "Open the database {{resourceId}} and read the Connectivity and security tab.",
          "Note the endpoint and the attached VPC security groups.",
          "Anything connecting from outside the VPC, including a developer laptop or an external analytics tool, will stop working. Plan for a bastion, a VPN, or Session Manager port forwarding first.",
        ],
        warning: "This change interrupts existing connections when it applies. Apply it in a maintenance window unless the database is already unused.",
      },
      {
        title: "Turn public access off",
        where: ["Database", "Modify", "Connectivity"],
        actions: [
          "Click Modify at the top right.",
          "Expand the Connectivity section and set Public access to Not publicly accessible.",
          "Click Continue, then choose Apply immediately if you can take the interruption now, or leave it for the next maintenance window.",
          "Click Modify DB instance.",
        ],
        fields: [{ label: "Public access", value: "Not publicly accessible", why: "Removes the public IP. The endpoint hostname stays the same but resolves only to a private address inside the VPC." }],
      },
      {
        title: "Tighten the security group as well",
        actions: [
          "Open the attached VPC security group and check its inbound rules.",
          "Replace any rule allowing the database port from a CIDR with one that references the application's security group.",
        ],
        note: "Public access and the security group are two independent controls. A database that is not publicly accessible but allows 0.0.0.0/0 on port 5432 is still open to everything inside the VPC.",
      },
    ],
    verify: [
      "Connectivity and security shows Publicly accessible: No.",
      "Resolving the endpoint from outside AWS returns a private address or nothing.",
      "The application inside the VPC still connects.",
    ],
    cli: {
      description: "Modify the instance. Omit --apply-immediately to wait for the maintenance window.",
      commands: ["aws rds modify-db-instance --region {{region}} --db-instance-identifier {{resourceId}} --no-publicly-accessible --apply-immediately"],
    },
  },

  {
    id: "fix-rds-backups",
    title: "Turn on RDS automated backups",
    category: "remediate",
    summary: "Set a backup retention period so point-in-time recovery works.",
    fixesRuleIds: ["RDS-NO-BACKUP"],
    estimatedMinutes: 5,
    steps: [
      {
        title: "Set the retention period",
        where: ["Console", "RDS", "Databases", "{{resourceId}}", "Modify"],
        target: { service: "rds", view: "database", resource: "{{resourceId}}" },
        actions: [
          "Open {{resourceId}} and click Modify.",
          "Scroll to Backup and set Backup retention period to 7 days or more.",
          "Set a Backup window during your quietest hours, or leave No preference.",
          "Click Continue, then Apply immediately, then Modify DB instance.",
        ],
        fields: [
          { label: "Backup retention period", value: "7 days (30 for production)", why: "A retention of 0 disables both automated backups and point-in-time recovery. Backup storage up to the size of the database is free." },
        ],
        note: "Changing retention from 0 to a positive number causes a brief outage while the first backup is taken. Going from one positive number to another does not.",
      },
      {
        title: "Confirm point-in-time recovery is available",
        actions: [
          "After the first backup completes, open the Maintenance and backups tab.",
          "Check that Latest restore time is populated. That timestamp is how far forward you could recover to.",
        ],
      },
    ],
    verify: ["Maintenance and backups shows the retention period and a latest restore time.", "The RDS-NO-BACKUP finding closes after the next sync."],
    cli: {
      description: "Set retention to seven days.",
      commands: ["aws rds modify-db-instance --region {{region}} --db-instance-identifier {{resourceId}} --backup-retention-period 7 --apply-immediately"],
    },
  },

  {
    id: "fix-rds-unencrypted",
    title: "Encrypt an existing RDS database",
    category: "remediate",
    summary: "Encryption cannot be added to a running database. This creates an encrypted replacement from a snapshot, which means a new endpoint and downtime.",
    fixesRuleIds: ["RDS-UNENCRYPTED", "RDS-CLUSTER-UNENCRYPTED"],
    estimatedMinutes: 60,
    prerequisites: ["A maintenance window long enough to restore the database and repoint the application."],
    steps: [
      {
        title: "Take a snapshot",
        where: ["Console", "RDS", "Databases", "{{resourceId}}"],
        target: { service: "rds", view: "database", resource: "{{resourceId}}" },
        actions: [
          "Open {{resourceId}}, then Actions and Take snapshot.",
          "Name it clearly and wait for it to become Available.",
        ],
      },
      {
        title: "Copy the snapshot with encryption",
        where: ["Console", "RDS", "Snapshots"],
        target: { service: "rds", view: "snapshots" },
        actions: [
          "Open Snapshots, select the new snapshot, then Actions and Copy snapshot.",
          "Check Enable encryption and select the default aws/rds key.",
          "Click Copy snapshot.",
        ],
      },
      {
        title: "Restore into a new encrypted instance",
        actions: [
          "Select the encrypted snapshot, then Actions and Restore snapshot.",
          "Give the new instance a new identifier, and set Public access to No and the correct VPC and security group.",
          "Expand Additional configuration and confirm a backup retention period is set.",
          "Click Restore DB instance and wait for it to become Available.",
        ],
        warning: "The restored instance has a different endpoint hostname. Every application, secret and connection string pointing at the old one must be updated.",
      },
      {
        title: "Cut over and retire the old instance",
        actions: [
          "Stop writes to the old database.",
          "Take a final snapshot of the old instance so any writes since the first snapshot are captured, and if there were writes, restore again from that one instead.",
          "Update the application's connection configuration, ideally the Secrets Manager secret, to the new endpoint.",
          "Verify the application, then delete the old instance with a final snapshot.",
        ],
        note: "If you cannot accept the write gap, use AWS Database Migration Service to replicate into the encrypted instance and cut over with minimal downtime.",
      },
    ],
    verify: ["The new instance's Configuration tab shows Encryption: Enabled.", "The application reads and writes against the new endpoint."],
    rollback: "Keep the old instance stopped rather than deleted until you are confident. A stopped RDS instance still bills for storage and restarts automatically after seven days.",
  },

  {
    id: "fix-lambda-runtime",
    title: "Move a Lambda function to a supported runtime",
    category: "remediate",
    summary: "Upgrade a function whose runtime is deprecated and no longer receiving security patches.",
    fixesRuleIds: ["LAMBDA-DEPRECATED-RUNTIME"],
    estimatedMinutes: 30,
    steps: [
      {
        title: "Check what the upgrade will break",
        where: ["Console", "Lambda", "Functions", "{{resourceId}}"],
        target: { service: "lambda", view: "function", resource: "{{resourceId}}" },
        actions: [
          "Open the function {{resourceId}} and note its current runtime under Runtime settings.",
          "Read the AWS runtime deprecation notes for the language to see what changed between versions.",
          "Test the code against the new runtime version locally or in a copy of the function before changing the live one.",
        ],
        warning: "A runtime upgrade is a language version upgrade. Dependencies compiled for the old version, and code relying on removed standard-library behaviour, will fail at invocation time rather than at deploy time.",
      },
      {
        title: "Publish a version, then change the runtime",
        actions: [
          "Under Actions, click Publish new version so you have an immutable copy to roll back to.",
          "Scroll to Runtime settings and click Edit.",
          "Select the supported runtime version and confirm the Handler string is still correct.",
          "Click Save.",
        ],
      },
      {
        title: "Test and roll forward carefully",
        actions: [
          "Use the Test tab with a representative event and confirm it succeeds.",
          "Check the function's CloudWatch logs for new warnings even if the invocation succeeded.",
          "If the function is behind an alias, shift traffic gradually with a weighted alias rather than switching everything at once.",
        ],
      },
    ],
    verify: ["Runtime settings shows the supported runtime.", "A test invocation succeeds and the logs are clean.", "Error and throttle metrics are unchanged an hour later."],
    rollback: "Point the alias back at the published version, or edit Runtime settings back if the old runtime still accepts new configuration (deprecated runtimes eventually stop accepting updates entirely).",
  },

  {
    id: "fix-dynamodb-pitr",
    title: "Enable point-in-time recovery on a DynamoDB table",
    category: "remediate",
    summary: "Continuous backups that let you restore the table to any second in the last 35 days.",
    fixesRuleIds: ["DDB-PITR"],
    estimatedMinutes: 2,
    steps: [
      {
        title: "Turn on PITR",
        where: ["Console", "DynamoDB", "Tables", "{{resourceId}}", "Backups"],
        target: { service: "dynamodb", view: "table", resource: "{{resourceId}}" },
        actions: [
          "Open the table {{resourceId}} and select the Backups tab.",
          "Under Point-in-time recovery (PITR), click Edit.",
          "Check Turn on point-in-time recovery and click Save changes.",
        ],
        note: "There is no downtime and no performance impact. Billing is per GB-month of continuous backup, typically a small fraction of the table's own cost.",
      },
      {
        title: "Consider deletion protection too",
        actions: [
          "On the table's Overview tab, under Additional settings, turn on Deletion protection.",
          "PITR protects against bad writes. Deletion protection protects against the table being removed entirely, which PITR cannot recover from once the table is gone.",
        ],
      },
    ],
    verify: ["The Backups tab shows Point-in-time recovery: On and an Earliest restore date."],
    cli: {
      description: "Enable continuous backups.",
      commands: ["aws dynamodb update-continuous-backups --region {{region}} --table-name {{resourceId}} --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true"],
    },
  },

  {
    id: "fix-ecr-scanning",
    title: "Turn on ECR image scanning and act on the results",
    category: "remediate",
    summary: "Scan container images for known vulnerabilities, and deal with the critical ones already found.",
    fixesRuleIds: ["ECR-SCAN-OFF", "ECR-CRITICAL-VULNS"],
    estimatedMinutes: 15,
    steps: [
      {
        title: "Enable scanning for the whole registry",
        where: ["Console", "ECR", "Private registry", "Scanning"],
        target: { service: "ecr", view: "repositories" },
        actions: [
          "In the ECR left sidebar, under Private registry, click Scanning.",
          "Click Edit and choose Enhanced scanning to have Amazon Inspector scan continuously, or Basic scanning to scan once on push.",
          "Apply it to all repositories rather than adding filters, unless you have a reason to exclude one.",
        ],
        note: "Enhanced scanning re-scans existing images as new vulnerabilities are published, so an image that was clean last month is re-flagged. It is billed per image scanned by Amazon Inspector; basic scanning is free but only runs on push.",
      },
      {
        title: "Review the critical findings on the affected repository",
        where: ["Console", "ECR", "Repositories", "{{resourceId}}"],
        target: { service: "ecr", view: "repository", resource: "{{resourceId}}" },
        actions: [
          "Open {{resourceId}} and select an image to see its vulnerability list.",
          "Sort by severity and look at what the critical findings are actually in: most come from the base image, not from your application code.",
        ],
      },
      {
        title: "Rebuild on a patched base image",
        actions: [
          "Update the FROM line in the Dockerfile to the current patch of the base image, and re-run the package manager update step so OS packages are refreshed.",
          "Rebuild, push, and confirm the new image scans clean.",
          "Add an ECR lifecycle policy to expire untagged images so old vulnerable layers do not linger and keep billing.",
        ],
        note: "Rebuilding without changing the base image tag often fixes nothing, because the build cache reuses the same layers. Pull the base image fresh.",
      },
    ],
    verify: ["The registry Scanning page shows scanning enabled.", "The newest image shows no critical findings.", "Running tasks and deployments are updated to the new image tag."],
  },

  {
    id: "fix-sqs-encryption",
    title: "Enable encryption at rest on an SQS queue",
    category: "remediate",
    summary: "Encrypt queued message bodies, which can contain personal data and identifiers.",
    fixesRuleIds: ["SQS-UNENCRYPTED"],
    estimatedMinutes: 5,
    steps: [
      {
        title: "Turn on server-side encryption",
        where: ["Console", "SQS", "Queues", "{{resourceId}}", "Edit"],
        target: { service: "sqs", view: "queues" },
        actions: [
          "Open the queue {{resourceId}} and click Edit.",
          "Under Encryption, set Server-side encryption to Enabled.",
          "Choose Amazon SQS key (SSE-SQS) for free, automatic encryption, or an AWS KMS key if you need to control and audit access to the key.",
          "Click Save.",
        ],
        fields: [
          { label: "Encryption key type", value: "Amazon SQS key (SSE-SQS)", why: "No cost, no key policy to maintain, and no risk of producers or consumers losing access. Choose SSE-KMS only when you need key-level access control." },
        ],
      },
      {
        title: "If you chose KMS, fix the permissions",
        actions: [
          "Every producer and consumer role needs kms:GenerateDataKey and kms:Decrypt on the key, in addition to their SQS permissions.",
          "If another AWS service (S3 events, SNS, EventBridge) sends to this queue, the key policy must allow that service principal as well, or deliveries will fail silently.",
        ],
        warning: "This is where KMS encryption on a queue usually goes wrong: the change succeeds, and messages stop being delivered because a publisher cannot use the key. Check the dead-letter queue and the publisher's error metrics after the change.",
      },
    ],
    verify: ["The queue's Encryption panel shows Server-side encryption: Enabled.", "Messages continue to flow: check the Monitoring tab for messages sent and received after the change."],
    cli: {
      description: "Enable the managed SQS key.",
      commands: ["aws sqs set-queue-attributes --region {{region}} --queue-url <queue-url> --attributes SqsManagedSseEnabled=true"],
    },
  },

  {
    id: "fix-eks-public-endpoint",
    title: "Restrict a public EKS cluster endpoint",
    category: "remediate",
    summary: "Stop the Kubernetes API server from accepting connections from the whole internet.",
    fixesRuleIds: ["EKS-PUBLIC-ENDPOINT"],
    estimatedMinutes: 15,
    steps: [
      {
        title: "Decide which mode you need",
        where: ["Console", "EKS", "Clusters", "{{resourceId}}", "Networking"],
        target: { service: "eks", view: "cluster", resource: "{{resourceId}}" },
        actions: [
          "Open the cluster {{resourceId}} and select the Networking tab.",
          "Public and private with restricted CIDRs is the usual answer: your office or VPN ranges can reach the API, nodes talk to it privately.",
          "Private only is stronger but means kubectl works solely from inside the VPC, through a bastion, VPN or Session Manager port forward.",
        ],
        warning: "Getting this wrong locks you out of your own cluster, including the ability to change it back through kubectl. You can still change the endpoint configuration through the console, the CLI or the API, which is your way back.",
      },
      {
        title: "Restrict the source ranges",
        actions: [
          "On the Networking tab, click Manage endpoint access.",
          "Keep Public access enabled and set Advanced settings to restrict access to specific CIDR blocks.",
          "Enter your VPN or office CIDRs. Do not enter 0.0.0.0/0, which is what the finding is about.",
          "Ensure Private access is enabled so nodes and in-VPC clients use the private path.",
          "Click Save changes. The update takes several minutes and does not interrupt running workloads.",
        ],
        fields: [
          { label: "Public access source allowlist", value: "Your VPN or office CIDRs", why: "The Kubernetes API is an authenticated endpoint, but exposing it to the internet means every authentication bug and every leaked kubeconfig is remotely exploitable." },
        ],
      },
      {
        title: "Confirm CI and automation still reach it",
        actions: [
          "Anything running outside the allowed ranges, including hosted CI runners, will now fail to reach the API.",
          "Either add the runner's egress addresses, or run deployments from inside the VPC with a self-hosted runner or CodeBuild.",
        ],
      },
    ],
    verify: [
      "The Networking tab shows Public access endpoint restricted with your CIDRs listed.",
      "kubectl works from an allowed network and times out from elsewhere.",
      "Nodes stay Ready and workloads are undisturbed.",
    ],
  },
];
