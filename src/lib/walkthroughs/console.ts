import { isKnownRegion } from "@/lib/regions";

/**
 * Deep links into the AWS Management Console.
 *
 * Every part of the resulting URL comes from a fixed allow-list: the hostname is built from a
 * validated region (or a known global host), the path/fragment comes from a hard-coded template,
 * and any resource id is pattern-checked before substitution. Nothing here accepts free-form
 * user input, so a link can never be pointed at a host we do not control the shape of.
 */

export type ConsoleServiceId =
  | "ec2"
  | "vpc"
  | "s3"
  | "rds"
  | "iam"
  | "cloudwatch"
  | "billing"
  | "cloudtrail"
  | "support"
  | "lambda"
  | "dynamodb"
  | "ecr"
  | "sqs"
  | "eks";

interface ServiceSpec {
  label: string;
  /** Global services are not region-scoped in the console hostname. */
  global?: boolean;
  /** Console host path, e.g. "ec2/home". */
  home: string;
  /** Host override for services that live on their own console subdomain. */
  host?: string;
  /** Allow-listed views. "{id}" is replaced by a validated resource id. */
  views: Record<string, string>;
}

/** Resource id shapes we are willing to place in a URL. */
const ID_PATTERNS: RegExp[] = [
  /^i-[0-9a-f]{8,17}$/,
  /^vol-[0-9a-f]{8,17}$/,
  /^snap-[0-9a-f]{8,17}$/,
  /^sg-[0-9a-f]{8,17}$/,
  /^vpc-[0-9a-f]{8,17}$/,
  /^subnet-[0-9a-f]{8,17}$/,
  /^rtb-[0-9a-f]{8,17}$/,
  /^igw-[0-9a-f]{8,17}$/,
  /^acl-[0-9a-f]{8,17}$/,
  /^eni-[0-9a-f]{8,17}$/,
  /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
];

const SERVICES: Record<ConsoleServiceId, ServiceSpec> = {
  ec2: {
    label: "EC2",
    home: "ec2/home",
    views: {
      instances: "#Instances:",
      instance: "#InstanceDetails:instanceId={id}",
      launch: "#LaunchInstances:",
      volumes: "#Volumes:",
      volume: "#VolumeDetails:volumeId={id}",
      snapshots: "#Snapshots:",
      securityGroups: "#SecurityGroups:",
      securityGroup: "#SecurityGroup:groupId={id}",
      keyPairs: "#KeyPairs:",
      amis: "#Images:visibility=public-images",
      ebsEncryptionSettings: "#Settings:tab=dataProtectionAndSecurity",
    },
  },
  vpc: {
    label: "VPC",
    home: "vpcconsole/home",
    views: {
      vpcs: "#vpcs:",
      vpc: "#VpcDetails:VpcId={id}",
      subnets: "#subnets:",
      subnet: "#SubnetDetails:subnetId={id}",
      routeTables: "#RouteTables:",
      internetGateways: "#igws:",
      natGateways: "#NatGateways:",
      networkAcls: "#acls:",
      endpoints: "#Endpoints:",
      createVpc: "#CreateVpc:createMode=vpcWithResources",
    },
  },
  s3: {
    label: "S3",
    global: true,
    host: "s3.console.aws.amazon.com",
    home: "s3",
    views: {
      buckets: "/buckets",
      bucket: "/buckets/{id}",
      bucketPermissions: "/buckets/{id}?tab=permissions",
      bucketProperties: "/buckets/{id}?tab=properties",
      createBucket: "/bucket/create",
      accountPublicAccess: "/settings",
    },
  },
  rds: {
    label: "RDS",
    home: "rds/home",
    views: {
      databases: "#databases:",
      database: "#database:id={id}",
      create: "#launch-dbinstance:",
      snapshots: "#db-snapshots:",
    },
  },
  iam: {
    label: "IAM",
    global: true,
    home: "iam/home",
    views: { roles: "#/roles", role: "#/roles/details/{id}", policies: "#/policies", users: "#/users" },
  },
  cloudwatch: {
    label: "CloudWatch",
    home: "cloudwatch/home",
    views: { alarms: "#alarmsV2:", metrics: "#metricsV2:", logs: "#logsV2:log-groups" },
  },
  billing: {
    label: "Billing and Cost Management",
    global: true,
    home: "costmanagement/home",
    views: { costExplorer: "#/cost-explorer", preferences: "#/settings" },
  },
  cloudtrail: { label: "CloudTrail", home: "cloudtrailv2/home", views: { trails: "#/trails", events: "#/events" } },
  lambda: { label: "Lambda", home: "lambda/home", views: { functions: "#/functions", function: "#/functions/{id}" } },
  dynamodb: { label: "DynamoDB", home: "dynamodbv2/home", views: { tables: "#tables", table: "#table?name={id}", backups: "#backups" } },
  ecr: { label: "ECR", home: "ecr", views: { repositories: "/repositories", repository: "/repositories/private/{id}" } },
  sqs: { label: "SQS", home: "sqs/v3/home", views: { queues: "#/queues" } },
  eks: { label: "EKS", home: "eks/home", views: { clusters: "#/clusters", cluster: "#/clusters/{id}" } },
  support: { label: "Support", global: true, home: "support/home", views: { cases: "#/case", quotas: "#/case/create" } },
};

export interface ConsoleTarget {
  service: ConsoleServiceId;
  /** Key from the service's allow-listed views. */
  view: string;
  /** Optional resource id substituted into the view template. */
  resource?: string;
}

export function consoleServiceLabel(service: ConsoleServiceId): string {
  return SERVICES[service].label;
}

/**
 * Builds the console URL for a target, or null when the region is unknown or the resource id
 * does not match a shape we recognise (in which case the caller shows the breadcrumb only).
 */
export function consoleUrl(target: ConsoleTarget, region: string): string | null {
  const spec = SERVICES[target.service];
  if (!spec) return null;
  const template = spec.views[target.view];
  if (template === undefined) return null;
  if (!isKnownRegion(region)) return null;

  let view = template;
  if (view.includes("{id}")) {
    const id = target.resource;
    if (!id || !ID_PATTERNS.some((re) => re.test(id))) return null;
    view = view.replace("{id}", encodeURIComponent(id));
  }

  const host = spec.host ?? (spec.global ? "console.aws.amazon.com" : `${region}.console.aws.amazon.com`);
  const [path, fragment] = splitFragment(view);
  const sep = path.includes("?") ? "&" : "?";
  return `https://${host}/${spec.home}${path}${sep}region=${region}${fragment}`;
}

function splitFragment(view: string): [string, string] {
  const i = view.indexOf("#");
  return i === -1 ? [view, ""] : [view.slice(0, i), view.slice(i)];
}
