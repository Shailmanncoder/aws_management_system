import type { Walkthrough } from "./types";

/**
 * Walkthroughs for creating things. Each step names the exact console location, the exact button
 * text, and the value to enter with the reason for it. Secure defaults are not presented as
 * optional extras: they are the value in the field, with the risk of the alternative stated.
 *
 * The AWS console is redesigned from time to time. Where a control is likely to move, the step
 * also says what to search for rather than relying only on a position on screen.
 */

export const CREATE_WALKTHROUGHS: Walkthrough[] = [
  {
    id: "ec2-launch-instance",
    title: "Launch an EC2 instance",
    category: "launch",
    summary: "A running Linux virtual machine in your own VPC, with encrypted storage, IMDSv2 required and no public IP.",
    estimatedMinutes: 10,
    prerequisites: [
      "A VPC with at least one subnet (the networking walkthrough creates one if you have none).",
      "Permission to launch instances in the account you are signed in to.",
    ],
    cost: "A t3.micro in most regions is roughly USD 7-9 per month if left running, plus about USD 0.08 per GB-month for the EBS volume. New accounts may have free-tier hours. You pay for every hour the instance exists in the running state, whether or not you use it.",
    steps: [
      {
        title: "Open the EC2 Instances list",
        where: ["Console", "EC2", "Instances"],
        target: { service: "ec2", view: "instances" },
        actions: [
          "Check the Region selector in the top-right of the console reads {{region}}. Instances only appear in the region they were created in, and this is the single most common reason people think a resource has vanished.",
          "In the left sidebar, under Instances, click Instances.",
          "Click the orange Launch instances button at the top right.",
        ],
      },
      {
        title: "Name and tag the instance",
        where: ["Launch an instance", "Name and tags"],
        actions: [
          "In the Name field, type a name that says what it is for, not what it is. A name like billing-api-staging is useful in six months; web-server-2 is not.",
          "Click Add additional tags to add the tags your workspace expects, so the instance can be attributed to a team and an environment later.",
        ],
        fields: [
          { label: "Name", value: "stratus-demo-01", why: "Becomes the Name tag. It is what you will see in every list, cost report and alert." },
          { label: "env", value: "dev", why: "Cost Explorer can group by tag, but only for tags activated as cost allocation tags. Untagged spend cannot be attributed to anyone." },
          { label: "owner", value: "your team name", why: "So the next person knows who to ask before stopping it." },
        ],
      },
      {
        title: "Choose the operating system image",
        where: ["Launch an instance", "Application and OS Images (Amazon Machine Image)"],
        actions: [
          "Select Amazon Linux from the Quick Start tabs, then leave the default Amazon Linux 2023 AMI selected.",
          "Confirm the architecture selector below the AMI reads 64-bit (x86). If you pick a Graviton AMI (64-bit Arm) you must also pick an Arm instance type such as t4g.micro, or the launch fails.",
          "Note the label Free tier eligible if it appears. It applies to the AMI, not to everything else you are about to select.",
        ],
        note: "Only launch AMIs from the Quick Start list or ones you own. Community AMIs are uploaded by anyone and run with your credentials.",
      },
      {
        title: "Choose the instance type",
        where: ["Launch an instance", "Instance type"],
        actions: [
          "Open the Instance type dropdown and select t3.micro (or t4g.micro if you chose an Arm AMI).",
          "Ignore the larger types for a first instance. Resizing later takes a stop and a start, which is far cheaper than paying for capacity you never used.",
        ],
        fields: [{ label: "Instance type", value: "t3.micro", why: "2 vCPU burstable, 1 GiB RAM. Enough to prove something works, small enough that forgetting it costs single-digit dollars." }],
      },
      {
        title: "Decide how you will log in",
        where: ["Launch an instance", "Key pair (login)"],
        actions: [
          "Select Proceed without a key pair if you will connect with AWS Systems Manager Session Manager. This is the safer choice: no SSH port open, no private key to lose, and every session is logged in CloudTrail.",
          "If you do want SSH, click Create new key pair, choose RSA and .pem, and save the file. AWS shows you the private key exactly once and cannot recover it.",
        ],
        warning: "The private key is a credential. Do not commit it to Git, paste it into a chat, or store it in a shared drive. Anyone with the file and the instance address can log in as root.",
      },
      {
        title: "Set the network and keep the instance off the public internet",
        where: ["Launch an instance", "Network settings", "Edit"],
        actions: [
          "Click Edit at the top right of the Network settings panel to see the full options.",
          "Set VPC to {{vpcId}}.",
          "Set Subnet to {{subnetId}}.",
          "Set Auto-assign public IP to Disable.",
          "Under Firewall (security groups), choose Select existing security group and pick {{securityGroupId}}, or choose Create security group and remove the default SSH rule that allows 0.0.0.0/0.",
        ],
        fields: [
          { label: "Auto-assign public IP", value: "Disable", why: "A public IP puts the instance on the internet the moment it boots, where it will be port-scanned within minutes. Reach it through Session Manager or a load balancer instead." },
          { label: "Source type (if creating a security group)", value: "My IP, never Anywhere", why: "Anywhere means 0.0.0.0/0. The console still offers it, and Stratus will raise a finding the next time it syncs." },
        ],
        warning: "The launch wizard pre-fills a security group rule allowing SSH from 0.0.0.0/0. Change or delete it before launching.",
      },
      {
        title: "Configure encrypted storage",
        where: ["Launch an instance", "Configure storage"],
        actions: [
          "Leave the root volume at 8 GiB gp3 unless you know you need more. You are billed for provisioned size, not for what you use.",
          "Click Advanced at the top right of the Configure storage panel.",
          "Set Encrypted to Yes. Leave the KMS key as the default aws/ebs key unless your organisation requires a customer-managed key.",
        ],
        fields: [
          { label: "Size", value: "8 GiB", why: "About USD 0.64 per month. Growing a volume later is possible; shrinking it is not." },
          { label: "Volume type", value: "gp3", why: "Cheaper than gp2 for the same size and gives a baseline 3,000 IOPS regardless of size." },
          { label: "Encrypted", value: "Yes", why: "Encryption cannot be turned on in place afterwards. Fixing it later means snapshot, copy with encryption, restore, swap." },
        ],
        note: "To stop having to remember this, enable EBS encryption by default for the region once: EC2 console, left sidebar, EBS encryption under Account attributes. It applies to new volumes only.",
      },
      {
        title: "Require IMDSv2",
        where: ["Launch an instance", "Advanced details"],
        target: { service: "ec2", view: "launch" },
        actions: [
          "Expand Advanced details (it is collapsed by default, near the bottom of the form).",
          "Scroll to Metadata version and select V2 only (token required).",
          "Set Metadata response hop limit to 1 unless containers on the instance need the metadata service.",
        ],
        warning: "This is the setting that turns a server-side request forgery bug in your application into a non-event. With IMDSv1 enabled, a single unvalidated URL fetch can read 169.254.169.254 and hand out the instance role's temporary credentials. Newer AMIs default to V2 only, but the wizard will honour whatever is set here.",
      },
      {
        title: "Review the summary and launch",
        where: ["Launch an instance", "Summary (right-hand panel)"],
        actions: [
          "Read the Summary panel on the right. It is the only place that shows every choice together.",
          "Confirm: number of instances is 1, the AMI and instance type match, the subnet is the one you chose, and Auto-assign public IP is Disabled.",
          "Click Launch instance.",
          "On the confirmation screen, click the instance id link to watch it start.",
        ],
      },
    ],
    verify: [
      "Instance state becomes Running and Status check shows 2/2 checks passed (this takes two to three minutes).",
      "The Networking tab shows a private IPv4 address and no public IPv4 address.",
      "The Storage tab shows Encrypted: Yes on the root volume.",
      "Trigger a sync in Stratus and the instance appears under EC2 with no new security findings.",
    ],
    rollback: "Select the instance, then Instance state, then Terminate instance. Termination is permanent and deletes the root volume. Stopping instead of terminating keeps the disk and stops the hourly instance charge, but you still pay for the EBS volume.",
    cli: {
      description: "The same launch from the AWS CLI. Replace the ids with your own; the metadata and encryption options are the parts worth copying.",
      commands: [
        "aws ec2 run-instances --region {{region}} --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --instance-type t3.micro --subnet-id {{subnetId}} --security-group-ids {{securityGroupId}} --no-associate-public-ip-address --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1 --block-device-mappings '[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":8,\"VolumeType\":\"gp3\",\"Encrypted\":true}}]' --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=stratus-demo-01},{Key=env,Value=dev}]'",
        "aws ec2 describe-instances --region {{region}} --filters Name=tag:Name,Values=stratus-demo-01 --query 'Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress]' --output table",
      ],
    },
    docs: [
      { label: "Launch an instance using the wizard", url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance-wizard.html" },
      { label: "Use IMDSv2", url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html" },
    ],
  },

  {
    id: "s3-create-bucket",
    title: "Create a private S3 bucket",
    category: "storage",
    summary: "A bucket that is blocked from public access, encrypted at rest and versioned, so a mistaken overwrite is recoverable.",
    estimatedMinutes: 5,
    cost: "Storage is about USD 0.023 per GB-month in us-east-1, plus a fraction of a cent per thousand requests. An empty bucket costs nothing. Versioning means deleted objects still occupy paid storage until a lifecycle rule expires them.",
    steps: [
      {
        title: "Open the S3 console",
        where: ["Console", "S3", "Buckets"],
        target: { service: "s3", view: "buckets" },
        actions: [
          "Open S3. The bucket list is global: every bucket in the account is shown regardless of the region selector.",
          "Click Create bucket at the top right.",
        ],
        note: "Bucket names are globally unique across every AWS account in the world, which is why short names are always taken. Do not put the account id or a customer name in the bucket name; the name is visible to anyone who can guess it.",
      },
      {
        title: "Name the bucket and choose the region",
        where: ["Create bucket", "General configuration"],
        actions: [
          "Set AWS Region to {{region}}. Data stays in this region, and cross-region transfer is billed.",
          "Enter a Bucket name using lowercase letters, numbers and hyphens only.",
          "Leave Bucket type as General purpose.",
        ],
        fields: [
          { label: "Bucket name", value: "yourorg-app-logs-{{region}}", why: "Prefix with something you own so the name is available, and include the purpose and region so it is obvious later." },
          { label: "Object Ownership", value: "ACLs disabled (recommended)", why: "With ACLs disabled the bucket owner owns every object and access is controlled only by policies. ACLs are the mechanism behind most accidental public buckets." },
        ],
      },
      {
        title: "Keep Block Public Access on",
        where: ["Create bucket", "Block Public Access settings for this bucket"],
        actions: [
          "Leave Block all public access checked. All four sub-settings stay on.",
          "Do not check the acknowledgement box. If you are building a public website, the answer is CloudFront with Origin Access Control, not a public bucket.",
        ],
        warning: "Unchecking this is the single step that turns a private bucket into a public one. Stratus reports it as a high-severity finding, but by then the data has been reachable.",
      },
      {
        title: "Turn on versioning and encryption",
        where: ["Create bucket", "Bucket Versioning / Default encryption"],
        actions: [
          "Under Bucket Versioning, select Enable.",
          "Under Default encryption, leave Server-side encryption with Amazon S3 managed keys (SSE-S3) selected. Choose SSE-KMS instead only if you need per-key access control or an audit trail of decryptions.",
          "Leave Bucket Key enabled when using SSE-KMS; it cuts KMS request charges substantially.",
          "Click Create bucket.",
        ],
        fields: [
          { label: "Bucket Versioning", value: "Enable", why: "An overwrite or delete keeps the previous version. This is the difference between an incident and an inconvenience, including for ransomware." },
          { label: "Default encryption", value: "SSE-S3 (AES256)", why: "Free, automatic, and satisfies encryption-at-rest requirements. SSE-KMS adds cost per request but lets you revoke access by key policy." },
        ],
        note: "Versioning keeps paying for old versions forever. After creating the bucket, open Management, then Create lifecycle rule, and expire noncurrent versions after 30 to 90 days.",
      },
    ],
    verify: [
      "The bucket's Permissions tab shows Block all public access: On, and Access: Bucket and objects not public.",
      "The Properties tab shows Bucket Versioning: Enabled and Default encryption enabled.",
      "After the next Stratus sync the bucket appears under S3 with no public-access finding.",
    ],
    rollback: "An empty bucket can be deleted from the bucket list. A versioned bucket must have all versions and delete markers removed first, which is easiest with a lifecycle rule or `aws s3 rm --recursive` followed by removing versions.",
    cli: {
      description: "Four calls, because a secure bucket is a create plus three settings. Run them in order.",
      commands: [
        "aws s3api create-bucket --bucket yourorg-app-logs --region {{region}} --create-bucket-configuration LocationConstraint={{region}}",
        "aws s3api put-public-access-block --bucket yourorg-app-logs --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        "aws s3api put-bucket-encryption --bucket yourorg-app-logs --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}'",
        "aws s3api put-bucket-versioning --bucket yourorg-app-logs --versioning-configuration Status=Enabled",
      ],
    },
    docs: [
      { label: "Creating a bucket", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html" },
      { label: "Blocking public access", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html" },
    ],
  },

  {
    id: "rds-create-database",
    title: "Create a managed database (RDS)",
    category: "storage",
    summary: "A PostgreSQL or MySQL instance that is encrypted, not reachable from the internet, backed up daily and has its password held in Secrets Manager.",
    estimatedMinutes: 15,
    prerequisites: ["A VPC with at least two subnets in different Availability Zones. RDS requires this even for a single-AZ database."],
    cost: "A db.t4g.micro is roughly USD 12-15 per month plus about USD 0.115 per GB-month of storage, and it bills whether or not anything connects to it. Multi-AZ doubles the instance cost. Backups up to the size of the database are free; beyond that they are billed as snapshot storage.",
    steps: [
      {
        title: "Open RDS and start the creation flow",
        where: ["Console", "RDS", "Databases"],
        target: { service: "rds", view: "databases" },
        actions: [
          "Confirm the region selector reads {{region}}.",
          "In the left sidebar click Databases, then click Create database.",
          "Choose Standard create. Easy create hides the network and encryption settings that matter here.",
        ],
      },
      {
        title: "Pick the engine and a template",
        where: ["Create database", "Engine options / Templates"],
        actions: [
          "Select PostgreSQL (or MySQL if your application requires it) and leave the latest default version selected.",
          "Under Templates choose Dev/Test for a non-production database, or Production if this will hold real data.",
          "Under Availability and durability, choose Single-AZ DB instance for dev, or Multi-AZ DB instance for production.",
        ],
        note: "The Production template turns on Multi-AZ, which doubles the instance cost. Choose it deliberately, not by reflex.",
      },
      {
        title: "Set the identifier and credentials",
        where: ["Create database", "Settings"],
        actions: [
          "Enter a DB instance identifier. This is the AWS-side name and becomes part of the endpoint hostname, so avoid anything sensitive.",
          "Leave Master username as postgres or set your own.",
          "Under Credentials management choose Managed in AWS Secrets Manager.",
        ],
        fields: [
          { label: "Credentials management", value: "Managed in AWS Secrets Manager", why: "AWS generates and stores the password and can rotate it. Nobody types it, pastes it into a ticket, or commits it. This costs about USD 0.40 per secret per month." },
          { label: "DB instance identifier", value: "app-db-dev", why: "Appears in the endpoint hostname, which is not secret but is guessable, so keep customer names out of it." },
        ],
        warning: "If you choose Self managed instead, the console shows the password once. Do not store it in a source file, environment file committed to Git, or a shared document.",
      },
      {
        title: "Size the instance and storage",
        where: ["Create database", "Instance configuration / Storage"],
        actions: [
          "Under Instance configuration select Burstable classes and pick db.t4g.micro or db.t4g.small.",
          "Set Allocated storage to 20 GiB, the minimum for gp3.",
          "Leave Enable storage autoscaling checked and set a maximum you are willing to pay for.",
        ],
        note: "Storage autoscaling grows the volume automatically and cannot shrink it again. The maximum threshold is the only thing standing between a runaway log table and a large bill.",
      },
      {
        title: "Keep the database off the internet",
        where: ["Create database", "Connectivity"],
        actions: [
          "Under Compute resource select Don't connect to an EC2 compute resource. You will attach the security group yourself, which is clearer than letting the wizard edit rules.",
          "Set Virtual private cloud (VPC) to {{vpcId}}.",
          "Under Public access select No.",
          "Under VPC security group choose an existing group whose only inbound rule allows the database port from your application's security group, not from a CIDR.",
        ],
        fields: [
          { label: "Public access", value: "No", why: "Yes assigns a public IP and makes the endpoint resolvable from the internet, where it will be found by scanners. This is the finding Stratus reports as RDS-PUBLIC." },
          { label: "Inbound rule source", value: "The application's security group id", why: "Referencing a security group instead of a CIDR means the rule keeps working when instances are replaced and never accidentally widens." },
        ],
      },
      {
        title: "Turn on encryption and backups",
        where: ["Create database", "Additional configuration"],
        actions: [
          "Expand Additional configuration.",
          "Enter an Initial database name, otherwise RDS creates the instance with no database inside it.",
          "Under Backup, confirm Enable automated backups is checked and set Backup retention period to 7 days or more.",
          "Under Encryption, confirm Enable encryption is checked.",
          "Check Enable deletion protection.",
          "Click Create database. Provisioning takes five to fifteen minutes.",
        ],
        fields: [
          { label: "Backup retention period", value: "7 days minimum", why: "0 disables backups entirely and also disables point-in-time recovery. Stratus reports retention under 7 days as RDS-NO-BACKUP." },
          { label: "Enable encryption", value: "Checked", why: "Encryption cannot be enabled on an existing RDS instance. The only fix afterwards is snapshot, copy the snapshot with encryption, and restore into a new instance with a new endpoint." },
        ],
        warning: "Encryption and the initial database name are set once at creation. Everything else on this page can be changed later.",
      },
    ],
    verify: [
      "Status becomes Available.",
      "The Connectivity and security tab shows Publicly accessible: No.",
      "The Configuration tab shows Encryption: Enabled and an automated backup window.",
      "Retrieve the password from Secrets Manager rather than from anyone's notes.",
    ],
    rollback: "Deletion protection must be turned off first (Modify, then uncheck, then apply). Deleting offers a final snapshot; take it unless you are certain. Snapshots are billed.",
    docs: [{ label: "Creating a DB instance", url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html" }],
  },

  {
    id: "vpc-create-network",
    title: "Create a VPC with public and private subnets",
    category: "network",
    summary: "A private network with public subnets for load balancers, private subnets for your servers and databases, and the routing wired up correctly.",
    estimatedMinutes: 10,
    cost: "The VPC, subnets, route tables and internet gateway are free. A NAT gateway is not: roughly USD 32 per month per gateway plus USD 0.045 per GB processed. This is the most common surprise on a small AWS bill.",
    steps: [
      {
        title: "Understand the four pieces before you click",
        actions: [
          "A VPC is a private IP range you own inside a region. Nothing in it is reachable from outside by default.",
          "A subnet is a slice of that range pinned to one Availability Zone. A subnet is public only because its route table sends 0.0.0.0/0 to an internet gateway, not because of any setting called public.",
          "An internet gateway attaches to the VPC and lets public subnets reach the internet, and be reached.",
          "A NAT gateway lets private subnets make outbound connections (package updates, API calls) without being reachable inbound. It lives in a public subnet and it costs money by the hour.",
        ],
      },
      {
        title: "Open the VPC console and start the wizard",
        where: ["Console", "VPC", "Your VPCs"],
        target: { service: "vpc", view: "vpcs" },
        actions: [
          "Confirm the region selector reads {{region}}.",
          "Click Create VPC at the top right.",
          "Select VPC and more rather than VPC only. It creates the subnets, route tables, internet gateway and associations together and wires them correctly, which is where hand-built VPCs usually go wrong.",
        ],
      },
      {
        title: "Fill in the wizard",
        where: ["Create VPC", "VPC settings"],
        target: { service: "vpc", view: "createVpc" },
        actions: [
          "Leave Name tag auto-generation checked and enter a short prefix such as your project name.",
          "Leave IPv4 CIDR block as 10.0.0.0/16 unless it overlaps a network you will peer with or connect by VPN. Overlapping ranges cannot be fixed later without rebuilding.",
          "Set Number of Availability Zones to 2.",
          "Set Number of public subnets to 2 and Number of private subnets to 2.",
          "Watch the preview panel on the right update as you change these. It shows exactly what will be created.",
        ],
        fields: [
          { label: "IPv4 CIDR block", value: "10.0.0.0/16", why: "65,536 addresses, room to add subnets later. A /16 costs nothing extra; a too-small range is painful to grow." },
          { label: "Number of Availability Zones", value: "2", why: "Two AZs is the minimum for a load balancer or an RDS subnet group, and it is what makes a single data centre failure survivable." },
        ],
      },
      {
        title: "Decide on NAT gateways, with the cost in front of you",
        where: ["Create VPC", "NAT gateways ($)"],
        actions: [
          "Choose None if nothing in the private subnets needs outbound internet access yet. You can add one later without rebuilding.",
          "Choose In 1 AZ for a development environment that needs to download packages. One gateway, about USD 32 per month.",
          "Choose 1 per AZ only for production, where losing outbound access in one AZ is unacceptable. That is roughly USD 64 per month before data charges.",
        ],
        warning: "AWS labels this section with a dollar sign for a reason. A NAT gateway left running in an unused development VPC is one of the most common wasted line items on an AWS bill, and Stratus will flag it as an optimization opportunity once it has usage data.",
      },
      {
        title: "Add the free S3 endpoint and create",
        where: ["Create VPC", "VPC endpoints"],
        actions: [
          "Under VPC endpoints select S3 Gateway.",
          "Click Create VPC. The wizard shows each resource as it is created.",
        ],
        note: "A gateway endpoint for S3 is free and routes S3 traffic off the NAT gateway, so it both saves money and keeps that traffic on the AWS network.",
      },
      {
        title: "Note the ids you will need",
        where: ["Console", "VPC", "Subnets"],
        target: { service: "vpc", view: "subnets" },
        actions: [
          "Open Subnets in the left sidebar and filter by your new VPC.",
          "Note which subnet ids are private: those are the ones you select when launching instances and databases.",
          "Check the Route table tab of a public subnet. It should show a route for 0.0.0.0/0 to an igw- target. A private subnet should show either no such route or one pointing to a nat- target.",
        ],
      },
    ],
    verify: [
      "Your VPCs shows the new VPC with your prefix in its name.",
      "Subnets shows four subnets across two Availability Zones.",
      "A public subnet's route table has 0.0.0.0/0 to igw-, and a private subnet's does not.",
      "After a Stratus sync, the Network page topology shows the new VPC with its subnets.",
    ],
    rollback: "Delete the VPC from Your VPCs; the console lists everything it will delete with it. It refuses while instances, databases or load balancers still exist inside. Delete NAT gateways explicitly if you want the charge to stop immediately.",
    docs: [{ label: "Create a VPC", url: "https://docs.aws.amazon.com/vpc/latest/userguide/create-vpc.html" }],
  },

  {
    id: "sg-create",
    title: "Create a security group that is not open to the internet",
    category: "network",
    summary: "A firewall rule set that references other security groups instead of IP ranges, so it stays correct as instances come and go.",
    estimatedMinutes: 5,
    cost: "Security groups are free. There is no limit worth worrying about at small scale.",
    steps: [
      {
        title: "Open Security groups",
        where: ["Console", "VPC", "Security groups"],
        target: { service: "ec2", view: "securityGroups" },
        actions: [
          "Security groups appear in both the EC2 and VPC consoles; they are the same objects.",
          "Click Create security group.",
        ],
        note: "A security group is stateful: if you allow a connection in, the reply is allowed out automatically. You almost never need to change outbound rules.",
      },
      {
        title: "Describe the group by its role",
        where: ["Create security group", "Basic details"],
        actions: [
          "Set Security group name to the role it serves, such as app-server or db-postgres. Rules will reference this group by name in your head for years.",
          "Write a Description that says what is allowed to talk to what. The field is required and cannot be edited after creation.",
          "Set VPC to {{vpcId}}. A security group belongs to exactly one VPC and cannot be moved.",
        ],
      },
      {
        title: "Add inbound rules that reference groups, not addresses",
        where: ["Create security group", "Inbound rules"],
        actions: [
          "Click Add rule.",
          "Choose the Type that matches the service (HTTPS, PostgreSQL, MySQL/Aurora) rather than Custom TCP, so the port is filled in for you.",
          "In the Source field, start typing sg- and select the security group of whatever is allowed to connect. Do not type a CIDR unless you genuinely mean a fixed network.",
          "If you must use an address, click the Source dropdown and choose My IP, which fills in your current address as a /32.",
        ],
        fields: [
          { label: "Source", value: "The calling resource's security group id", why: "Instances get new private IPs when replaced. A group reference follows them; a hard-coded IP silently stops matching or, worse, starts matching something else." },
          { label: "Source for administrative access", value: "Do not open port 22 or 3389 at all", why: "Use Systems Manager Session Manager. It needs no inbound rule, no bastion and no key, and every session is recorded in CloudTrail." },
        ],
        warning: "Never select Anywhere-IPv4 (0.0.0.0/0) for SSH (22), RDP (3389), or any database port (3306, 5432, 1433, 27017, 6379). Stratus reports these as SG-OPEN, the highest-severity network finding, because these ports are scanned continuously across the whole internet.",
      },
      {
        title: "Leave outbound alone and create",
        where: ["Create security group", "Outbound rules"],
        actions: [
          "Leave the default All traffic to 0.0.0.0/0 outbound rule in place unless you have a specific egress-control requirement.",
          "Add your tags, then click Create security group.",
        ],
        note: "Locking down outbound traffic is a legitimate control, but it breaks package installs, agent check-ins and AWS API calls in ways that are hard to debug. Do it deliberately, with VPC endpoints in place first.",
      },
    ],
    verify: [
      "The group appears in the list attached to {{vpcId}}.",
      "The Inbound rules tab shows no rule whose source is 0.0.0.0/0 or ::/0 on an administrative or database port.",
      "After the next Stratus sync, the Network page shows the group with an empty Internet-open column.",
    ],
    rollback: "Select the group and choose Delete. AWS refuses while any network interface still uses it, and refuses to delete a VPC's default group.",
    cli: {
      description: "Creating the group and adding a group-referencing rule.",
      commands: [
        "aws ec2 create-security-group --region {{region}} --group-name app-server --description 'App servers: HTTPS from the load balancer only' --vpc-id {{vpcId}}",
        "aws ec2 authorize-security-group-ingress --region {{region}} --group-id <new-sg-id> --protocol tcp --port 443 --source-group {{securityGroupId}}",
      ],
    },
  },
];
