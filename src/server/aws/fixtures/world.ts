/**
 * SYNTHETIC FIXTURE DATA — used only when AWS_MODE=fixtures (forbidden in production by env
 * validation) and in automated tests. Account IDs are AWS documentation-style placeholders.
 *
 * The world intentionally contains hazards the pipeline must handle safely:
 *  - Lambda environment variables containing secret-looking values (must never be stored)
 *  - a region whose EC2 API fails (partial sync)
 *  - accounts with denied permissions / services not enabled
 *  - public buckets, open SSH, unencrypted & public databases, idle resources
 */

export const FIXTURE_ACCOUNTS = {
  PROD: "123456789012",
  STAGING: "210987654321",
  LIMITED: "444455556666",
} as const;

const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

export interface FxInstance {
  id: string;
  name: string;
  region: string;
  az: string;
  type: string;
  arch: "x86_64" | "arm64";
  state: "running" | "stopped";
  stoppedDaysAgo?: number;
  launchedDaysAgo: number;
  vpcId: string;
  subnetId: string;
  sgIds: string[];
  publicIp?: string;
  privateIp: string;
  profile?: string;
  volumeIds: string[];
  cpuAvg: number;
  tags?: Record<string, string>;
}

export interface FxBucket {
  name: string;
  region: string;
  createdDaysAgo: number;
  sse: "AES256" | "aws:kms";
  versioning: "Enabled" | "Suspended" | null;
  pab: { BlockPublicAcls: boolean; IgnorePublicAcls: boolean; BlockPublicPolicy: boolean; RestrictPublicBuckets: boolean } | null;
  policyPublic: boolean | null;
  aclAllUsers: boolean;
  logging: boolean;
  lifecycle: boolean;
  tags?: Record<string, string>;
}

export interface FxWorld {
  regions: string[];
  failingRegions?: Record<string, string>; // region -> error code for EC2 describe calls
  denied?: string[]; // "service:Command" patterns that return AccessDenied
  notEnabled?: string[]; // "service:Command" that return a not-enabled error
  instances: FxInstance[];
  volumes: { id: string; region: string; az: string; sizeGiB: number; type: string; encrypted: boolean; attachedTo?: string; createdDaysAgo: number }[];
  snapshots: { id: string; region: string; volumeId: string; sizeGiB: number; createdDaysAgo: number; encrypted: boolean }[];
  addresses: { allocationId: string; region: string; publicIp: string; instanceId?: string }[];
  vpcs: { id: string; region: string; cidr: string; name: string; isDefault: boolean }[];
  subnets: { id: string; region: string; vpcId: string; az: string; cidr: string; name: string; public: boolean }[];
  igws: { id: string; region: string; vpcId: string }[];
  nats: { id: string; region: string; vpcId: string; subnetId: string; publicIp: string }[];
  routeTables: { id: string; region: string; vpcId: string; subnetIds: string[]; routes: { dest: string; target: string }[]; main?: boolean }[];
  securityGroups: { id: string; region: string; vpcId: string; name: string; ingress: { proto: string; from: number; to: number; cidr?: string; ipv6?: string; sg?: string }[] }[];
  nacls: { id: string; region: string; vpcId: string; isDefault: boolean; subnetIds: string[] }[];
  vpcEndpoints: { id: string; region: string; vpcId: string; service: string; type: "Gateway" | "Interface" }[];
  buckets: FxBucket[];
  accountPab: boolean;
  rds: { id: string; region: string; engine: string; version: string; cls: string; status: string; storageGiB: number; encrypted: boolean; public: boolean; multiAz: boolean; backupDays: number; vpcId: string; subnetIds: string[]; clusterId?: string }[];
  rdsClusters: { id: string; region: string; engine: string; version: string; status: string; encrypted: boolean; members: string[]; serverless: boolean }[];
  dynamo: { name: string; region: string; billing: "PAY_PER_REQUEST" | "PROVISIONED"; rcu?: number; wcu?: number; items: number; sizeBytes: number; pitr: boolean; sse: "KMS" | "DEFAULT" }[];
  lambdas: { name: string; region: string; runtime: string; memory: number; timeout: number; arch: "x86_64" | "arm64"; modifiedDaysAgo: number; vpcId?: string; layers: number; env?: Record<string, string>; tags?: Record<string, string> }[];
  ecsClusters: { name: string; region: string; services: { name: string; desired: number; running: number; launchType: "FARGATE" | "EC2" }[] }[];
  eksClusters: { name: string; region: string; version: string; status: string; publicAccess: boolean; privateAccess: boolean; publicCidrs: string[] }[];
  ecrRepos: { name: string; region: string; images: number; scanOnPush: boolean; critical: number; high: number; mutable: boolean }[];
  loadBalancers: { name: string; region: string; type: "application" | "network"; scheme: "internet-facing" | "internal"; vpcId: string; subnetIds: string[]; sgIds: string[]; dns: string }[];
  cloudfront: { id: string; domain: string; enabled: boolean; aliases: string[] }[];
  hostedZones: { id: string; name: string; private: boolean; records: number }[];
  restApis: { id: string; region: string; name: string }[];
  httpApis: { id: string; region: string; name: string }[];
  topics: { name: string; region: string }[];
  queues: { name: string; region: string; encrypted: boolean }[];
  iam: { mfaRoot: boolean; rootKeys: boolean; passwordPolicy: boolean; users: { name: string; keys: { id: string; ageDays: number; active: boolean }[] }[] };
  trails: { name: string; homeRegion: string; multiRegion: boolean; logging: boolean }[];
  guardduty: Record<string, { id: string; type: string; severity: number; title: string; resourceType: string; daysAgo: number }[] | "disabled">;
  securityhub: Record<string, { id: string; title: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL"; resourceId: string; daysAgo: number }[] | "disabled">;
  cost: { baseDaily: number; services: [string, number][]; regions: [string, number][] } | "denied";
}

const fakeKeyId = (seed: string) => `AKIAFIXTURE${seed.toUpperCase().padEnd(9, "X").slice(0, 9)}`;

const PROD: FxWorld = {
  regions: ["eu-west-1", "us-east-1", "us-west-2"],
  instances: [
    { id: "i-0a1b2c3d4e5f60001", name: "web-1", region: "us-east-1", az: "us-east-1a", type: "t3.medium", arch: "x86_64", state: "running", launchedDaysAgo: 120, vpcId: "vpc-0prod0001", subnetId: "subnet-0pub0001a", sgIds: ["sg-0web00001"], publicIp: "198.51.100.10", privateIp: "10.0.1.10", profile: "web-instance-profile", volumeIds: ["vol-0web00001"], cpuAvg: 38, tags: { env: "prod", team: "web", "cost-center": "cc-100" } },
    { id: "i-0a1b2c3d4e5f60002", name: "web-2", region: "us-east-1", az: "us-east-1b", type: "t3.medium", arch: "x86_64", state: "running", launchedDaysAgo: 118, vpcId: "vpc-0prod0001", subnetId: "subnet-0pub0001b", sgIds: ["sg-0web00001"], publicIp: "198.51.100.11", privateIp: "10.0.2.11", profile: "web-instance-profile", volumeIds: ["vol-0web00002"], cpuAvg: 41, tags: { env: "prod", team: "web", "cost-center": "cc-100" } },
    { id: "i-0a1b2c3d4e5f60003", name: "api-1", region: "us-east-1", az: "us-east-1a", type: "m6i.large", arch: "x86_64", state: "running", launchedDaysAgo: 90, vpcId: "vpc-0prod0001", subnetId: "subnet-0prv0001a", sgIds: ["sg-0api00001"], privateIp: "10.0.11.20", profile: "api-instance-profile", volumeIds: ["vol-0api00001"], cpuAvg: 55, tags: { env: "prod", team: "api", "cost-center": "cc-200" } },
    { id: "i-0a1b2c3d4e5f60004", name: "reporting-large", region: "us-east-1", az: "us-east-1b", type: "m6i.4xlarge", arch: "x86_64", state: "running", launchedDaysAgo: 200, vpcId: "vpc-0prod0001", subnetId: "subnet-0prv0001b", sgIds: ["sg-0api00001"], privateIp: "10.0.12.30", volumeIds: ["vol-0rep00001"], cpuAvg: 2.1, tags: { env: "prod", team: "data" } },
    { id: "i-0a1b2c3d4e5f60005", name: "bastion", region: "us-east-1", az: "us-east-1a", type: "t3.micro", arch: "x86_64", state: "running", launchedDaysAgo: 400, vpcId: "vpc-0prod0001", subnetId: "subnet-0pub0001a", sgIds: ["sg-0bastion01"], publicIp: "198.51.100.12", privateIp: "10.0.1.5", volumeIds: ["vol-0bas00001"], cpuAvg: 1.2, tags: { env: "prod", team: "platform", note: "<img src=x onerror=\"window.__xss=1\">" } },
    { id: "i-0a1b2c3d4e5f60006", name: "batch-worker", region: "us-east-1", az: "us-east-1b", type: "c6i.xlarge", arch: "x86_64", state: "stopped", stoppedDaysAgo: 45, launchedDaysAgo: 300, vpcId: "vpc-0prod0001", subnetId: "subnet-0prv0001b", sgIds: ["sg-0api00001"], privateIp: "10.0.12.40", volumeIds: ["vol-0bat00001"], cpuAvg: 0, tags: { env: "prod", team: "data", "cost-center": "cc-300" } },
    { id: "i-0a1b2c3d4e5f60007", name: "analytics-1", region: "eu-west-1", az: "eu-west-1a", type: "r6g.large", arch: "arm64", state: "running", launchedDaysAgo: 60, vpcId: "vpc-0euw00001", subnetId: "subnet-0euw0001a", sgIds: ["sg-0euw00001"], privateIp: "10.20.1.15", volumeIds: ["vol-0euw00001"], cpuAvg: 22, tags: { env: "prod", team: "data", "cost-center": "cc-300" } },
    { id: "i-0a1b2c3d4e5f60008", name: "dev-box", region: "us-west-2", az: "us-west-2a", type: "t3.large", arch: "x86_64", state: "stopped", stoppedDaysAgo: 3, launchedDaysAgo: 30, vpcId: "vpc-0usw00001", subnetId: "subnet-0usw0001a", sgIds: ["sg-0usw00001"], privateIp: "10.30.1.8", volumeIds: ["vol-0dev00001"], cpuAvg: 0 },
    { id: "i-0a1b2c3d4e5f60009", name: "canary", region: "us-west-2", az: "us-west-2b", type: "t4g.small", arch: "arm64", state: "running", launchedDaysAgo: 10, vpcId: "vpc-0usw00001", subnetId: "subnet-0usw0001a", sgIds: ["sg-0usw00001"], privateIp: "10.30.1.9", volumeIds: ["vol-0can00001"], cpuAvg: 12, tags: { env: "prod", team: "sre" } },
  ],
  volumes: [
    { id: "vol-0web00001", region: "us-east-1", az: "us-east-1a", sizeGiB: 30, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60001", createdDaysAgo: 120 },
    { id: "vol-0web00002", region: "us-east-1", az: "us-east-1b", sizeGiB: 30, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60002", createdDaysAgo: 118 },
    { id: "vol-0api00001", region: "us-east-1", az: "us-east-1a", sizeGiB: 50, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60003", createdDaysAgo: 90 },
    { id: "vol-0rep00001", region: "us-east-1", az: "us-east-1b", sizeGiB: 500, type: "gp2", encrypted: false, attachedTo: "i-0a1b2c3d4e5f60004", createdDaysAgo: 200 },
    { id: "vol-0bas00001", region: "us-east-1", az: "us-east-1a", sizeGiB: 8, type: "gp2", encrypted: false, attachedTo: "i-0a1b2c3d4e5f60005", createdDaysAgo: 400 },
    { id: "vol-0bat00001", region: "us-east-1", az: "us-east-1b", sizeGiB: 200, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60006", createdDaysAgo: 300 },
    { id: "vol-0euw00001", region: "eu-west-1", az: "eu-west-1a", sizeGiB: 100, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60007", createdDaysAgo: 60 },
    { id: "vol-0dev00001", region: "us-west-2", az: "us-west-2a", sizeGiB: 50, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60008", createdDaysAgo: 30 },
    { id: "vol-0can00001", region: "us-west-2", az: "us-west-2b", sizeGiB: 20, type: "gp3", encrypted: true, attachedTo: "i-0a1b2c3d4e5f60009", createdDaysAgo: 10 },
    { id: "vol-0orphan0001", region: "us-east-1", az: "us-east-1a", sizeGiB: 250, type: "gp2", encrypted: false, createdDaysAgo: 150 },
    { id: "vol-0orphan0002", region: "eu-west-1", az: "eu-west-1b", sizeGiB: 100, type: "io2", encrypted: true, createdDaysAgo: 75 },
  ],
  snapshots: [
    { id: "snap-0old000001", region: "us-east-1", volumeId: "vol-0rep00001", sizeGiB: 500, createdDaysAgo: 420, encrypted: false },
    { id: "snap-0old000002", region: "us-east-1", volumeId: "vol-0api00001", sizeGiB: 50, createdDaysAgo: 380, encrypted: true },
    { id: "snap-0new000001", region: "us-east-1", volumeId: "vol-0api00001", sizeGiB: 50, createdDaysAgo: 2, encrypted: true },
  ],
  addresses: [
    { allocationId: "eipalloc-0used00001", region: "us-east-1", publicIp: "198.51.100.12", instanceId: "i-0a1b2c3d4e5f60005" },
    { allocationId: "eipalloc-0free00001", region: "us-east-1", publicIp: "198.51.100.99" },
    { allocationId: "eipalloc-0free00002", region: "eu-west-1", publicIp: "203.0.113.50" },
  ],
  vpcs: [
    { id: "vpc-0prod0001", region: "us-east-1", cidr: "10.0.0.0/16", name: "prod-vpc", isDefault: false },
    { id: "vpc-0euw00001", region: "eu-west-1", cidr: "10.20.0.0/16", name: "eu-analytics-vpc", isDefault: false },
    { id: "vpc-0usw00001", region: "us-west-2", cidr: "10.30.0.0/16", name: "dev-vpc", isDefault: false },
  ],
  subnets: [
    { id: "subnet-0pub0001a", region: "us-east-1", vpcId: "vpc-0prod0001", az: "us-east-1a", cidr: "10.0.1.0/24", name: "prod-public-a", public: true },
    { id: "subnet-0pub0001b", region: "us-east-1", vpcId: "vpc-0prod0001", az: "us-east-1b", cidr: "10.0.2.0/24", name: "prod-public-b", public: true },
    { id: "subnet-0prv0001a", region: "us-east-1", vpcId: "vpc-0prod0001", az: "us-east-1a", cidr: "10.0.11.0/24", name: "prod-private-a", public: false },
    { id: "subnet-0prv0001b", region: "us-east-1", vpcId: "vpc-0prod0001", az: "us-east-1b", cidr: "10.0.12.0/24", name: "prod-private-b", public: false },
    { id: "subnet-0euw0001a", region: "eu-west-1", vpcId: "vpc-0euw00001", az: "eu-west-1a", cidr: "10.20.1.0/24", name: "eu-private-a", public: false },
    { id: "subnet-0usw0001a", region: "us-west-2", vpcId: "vpc-0usw00001", az: "us-west-2a", cidr: "10.30.1.0/24", name: "dev-a", public: false },
  ],
  igws: [{ id: "igw-0prod00001", region: "us-east-1", vpcId: "vpc-0prod0001" }],
  nats: [{ id: "nat-0prod00001", region: "us-east-1", vpcId: "vpc-0prod0001", subnetId: "subnet-0pub0001a", publicIp: "198.51.100.20" }],
  routeTables: [
    { id: "rtb-0pub00001", region: "us-east-1", vpcId: "vpc-0prod0001", subnetIds: ["subnet-0pub0001a", "subnet-0pub0001b"], routes: [{ dest: "10.0.0.0/16", target: "local" }, { dest: "0.0.0.0/0", target: "igw-0prod00001" }] },
    { id: "rtb-0prv00001", region: "us-east-1", vpcId: "vpc-0prod0001", subnetIds: ["subnet-0prv0001a", "subnet-0prv0001b"], routes: [{ dest: "10.0.0.0/16", target: "local" }, { dest: "0.0.0.0/0", target: "nat-0prod00001" }] },
    { id: "rtb-0main0001", region: "us-east-1", vpcId: "vpc-0prod0001", subnetIds: [], routes: [{ dest: "10.0.0.0/16", target: "local" }], main: true },
    { id: "rtb-0euw00001", region: "eu-west-1", vpcId: "vpc-0euw00001", subnetIds: ["subnet-0euw0001a"], routes: [{ dest: "10.20.0.0/16", target: "local" }], main: true },
    { id: "rtb-0usw00001", region: "us-west-2", vpcId: "vpc-0usw00001", subnetIds: ["subnet-0usw0001a"], routes: [{ dest: "10.30.0.0/16", target: "local" }], main: true },
  ],
  securityGroups: [
    { id: "sg-0web00001", region: "us-east-1", vpcId: "vpc-0prod0001", name: "web-sg", ingress: [{ proto: "tcp", from: 443, to: 443, cidr: "0.0.0.0/0" }, { proto: "tcp", from: 80, to: 80, cidr: "0.0.0.0/0" }] },
    { id: "sg-0api00001", region: "us-east-1", vpcId: "vpc-0prod0001", name: "api-sg", ingress: [{ proto: "tcp", from: 8080, to: 8080, sg: "sg-0web00001" }] },
    { id: "sg-0bastion01", region: "us-east-1", vpcId: "vpc-0prod0001", name: "bastion-sg", ingress: [{ proto: "tcp", from: 22, to: 22, cidr: "0.0.0.0/0" }, { proto: "tcp", from: 3389, to: 3389, ipv6: "::/0" }] },
    { id: "sg-0db000001", region: "us-east-1", vpcId: "vpc-0prod0001", name: "db-sg", ingress: [{ proto: "tcp", from: 5432, to: 5432, sg: "sg-0api00001" }, { proto: "tcp", from: 3306, to: 3306, cidr: "0.0.0.0/0" }] },
    { id: "sg-0wide00001", region: "us-east-1", vpcId: "vpc-0prod0001", name: "legacy-allow-all", ingress: [{ proto: "-1", from: -1, to: -1, cidr: "0.0.0.0/0" }] },
    { id: "sg-0euw00001", region: "eu-west-1", vpcId: "vpc-0euw00001", name: "analytics-sg", ingress: [{ proto: "tcp", from: 443, to: 443, cidr: "10.0.0.0/8" }] },
    { id: "sg-0usw00001", region: "us-west-2", vpcId: "vpc-0usw00001", name: "dev-sg", ingress: [{ proto: "tcp", from: 22, to: 22, cidr: "10.0.0.0/8" }] },
  ],
  nacls: [
    { id: "acl-0prod00001", region: "us-east-1", vpcId: "vpc-0prod0001", isDefault: true, subnetIds: ["subnet-0pub0001a", "subnet-0pub0001b", "subnet-0prv0001a", "subnet-0prv0001b"] },
    { id: "acl-0euw00001", region: "eu-west-1", vpcId: "vpc-0euw00001", isDefault: true, subnetIds: ["subnet-0euw0001a"] },
  ],
  vpcEndpoints: [{ id: "vpce-0s3gw00001", region: "us-east-1", vpcId: "vpc-0prod0001", service: "com.amazonaws.us-east-1.s3", type: "Gateway" }],
  buckets: [
    { name: "acme-prod-assets", region: "us-east-1", createdDaysAgo: 700, sse: "aws:kms", versioning: "Enabled", pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, policyPublic: false, aclAllUsers: false, logging: true, lifecycle: true, tags: { env: "prod", "cost-center": "cc-100" } },
    { name: "acme-public-website", region: "us-east-1", createdDaysAgo: 500, sse: "AES256", versioning: null, pab: { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false }, policyPublic: true, aclAllUsers: true, logging: false, lifecycle: false, tags: { env: "prod" } },
    { name: "acme-app-logs", region: "us-east-1", createdDaysAgo: 900, sse: "AES256", versioning: "Suspended", pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, policyPublic: false, aclAllUsers: false, logging: false, lifecycle: false },
    { name: "acme-partner-exchange", region: "us-west-2", createdDaysAgo: 200, sse: "AES256", versioning: "Enabled", pab: null, policyPublic: false, aclAllUsers: false, logging: false, lifecycle: true, tags: { team: "partners" } },
    { name: "acme-eu-datalake", region: "eu-west-1", createdDaysAgo: 365, sse: "aws:kms", versioning: "Enabled", pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, policyPublic: null, aclAllUsers: false, logging: true, lifecycle: false, tags: { env: "prod", team: "data" } },
  ],
  accountPab: false,
  rds: [
    { id: "orders-db", region: "us-east-1", engine: "postgres", version: "16.4", cls: "db.m6g.large", status: "available", storageGiB: 200, encrypted: true, public: false, multiAz: true, backupDays: 14, vpcId: "vpc-0prod0001", subnetIds: ["subnet-0prv0001a", "subnet-0prv0001b"] },
    { id: "legacy-mysql", region: "us-east-1", engine: "mysql", version: "5.7.44", cls: "db.t3.medium", status: "available", storageGiB: 100, encrypted: false, public: true, multiAz: false, backupDays: 0, vpcId: "vpc-0prod0001", subnetIds: ["subnet-0pub0001a", "subnet-0pub0001b"] },
    { id: "analytics-aurora-1", region: "eu-west-1", engine: "aurora-postgresql", version: "16.2", cls: "db.r6g.large", status: "available", storageGiB: 0, encrypted: true, public: false, multiAz: false, backupDays: 7, vpcId: "vpc-0euw00001", subnetIds: ["subnet-0euw0001a"], clusterId: "analytics-aurora" },
  ],
  rdsClusters: [{ id: "analytics-aurora", region: "eu-west-1", engine: "aurora-postgresql", version: "16.2", status: "available", encrypted: true, members: ["analytics-aurora-1"], serverless: false }],
  dynamo: [
    { name: "sessions", region: "us-east-1", billing: "PAY_PER_REQUEST", items: 182_000, sizeBytes: 94_000_000, pitr: true, sse: "KMS" },
    { name: "events", region: "us-east-1", billing: "PROVISIONED", rcu: 400, wcu: 200, items: 5_400_000, sizeBytes: 2_300_000_000, pitr: false, sse: "DEFAULT" },
  ],
  lambdas: [
    { name: "image-resizer", region: "us-east-1", runtime: "nodejs20.x", memory: 1024, timeout: 30, arch: "arm64", modifiedDaysAgo: 12, layers: 1, env: { BUCKET: "acme-prod-assets" }, tags: { team: "web" } },
    { name: "orders-processor", region: "us-east-1", runtime: "python3.12", memory: 512, timeout: 60, arch: "x86_64", modifiedDaysAgo: 40, vpcId: "vpc-0prod0001", layers: 2, env: { DB_PASSWORD: "fixture-secret-must-never-be-stored", STRIPE_API_KEY: "sk_test_fixture_never_store" }, tags: { team: "api" } },
    { name: "legacy-cron", region: "us-east-1", runtime: "python3.8", memory: 128, timeout: 900, arch: "x86_64", modifiedDaysAgo: 800, layers: 0 },
    { name: "eu-etl", region: "eu-west-1", runtime: "java21", memory: 2048, timeout: 300, arch: "arm64", modifiedDaysAgo: 5, layers: 0, tags: { team: "data" } },
    { name: "canary-probe", region: "us-west-2", runtime: "nodejs22.x", memory: 256, timeout: 10, arch: "arm64", modifiedDaysAgo: 2, layers: 0 },
  ],
  ecsClusters: [{ name: "prod-cluster", region: "us-east-1", services: [{ name: "checkout", desired: 4, running: 4, launchType: "FARGATE" }, { name: "notifications", desired: 2, running: 1, launchType: "FARGATE" }] }],
  eksClusters: [{ name: "platform-eks", region: "us-east-1", version: "1.31", status: "ACTIVE", publicAccess: true, privateAccess: true, publicCidrs: ["0.0.0.0/0"] }],
  ecrRepos: [
    { name: "checkout", region: "us-east-1", images: 42, scanOnPush: true, critical: 0, high: 2, mutable: false },
    { name: "notifications", region: "us-east-1", images: 17, scanOnPush: false, critical: 1, high: 4, mutable: true },
    { name: "etl", region: "eu-west-1", images: 8, scanOnPush: true, critical: 0, high: 0, mutable: false },
  ],
  loadBalancers: [
    { name: "prod-alb", region: "us-east-1", type: "application", scheme: "internet-facing", vpcId: "vpc-0prod0001", subnetIds: ["subnet-0pub0001a", "subnet-0pub0001b"], sgIds: ["sg-0web00001"], dns: "prod-alb-1234567890.us-east-1.elb.amazonaws.com" },
    { name: "internal-nlb", region: "us-east-1", type: "network", scheme: "internal", vpcId: "vpc-0prod0001", subnetIds: ["subnet-0prv0001a", "subnet-0prv0001b"], sgIds: [], dns: "internal-nlb-0987654321.elb.us-east-1.amazonaws.com" },
  ],
  cloudfront: [{ id: "E2FIXTURE0001", domain: "d111111abcdef8.cloudfront.net", enabled: true, aliases: ["www.example.com"] }],
  hostedZones: [
    { id: "/hostedzone/Z0FIXTURE00001", name: "example.com.", private: false, records: 24 },
    { id: "/hostedzone/Z0FIXTURE00002", name: "internal.example.", private: true, records: 9 },
  ],
  restApis: [{ id: "a1b2c3d4e5", region: "us-east-1", name: "public-api" }],
  httpApis: [{ id: "f6g7h8i9j0", region: "eu-west-1", name: "eu-webhooks" }],
  topics: [{ name: "alerts", region: "us-east-1" }, { name: "order-events", region: "us-east-1" }],
  queues: [{ name: "order-jobs", region: "us-east-1", encrypted: true }, { name: "legacy-queue", region: "us-east-1", encrypted: false }],
  iam: {
    mfaRoot: true,
    rootKeys: false,
    passwordPolicy: true,
    users: [
      { name: "ci-deployer", keys: [{ id: fakeKeyId("cidep"), ageDays: 420, active: true }] },
      { name: "alice-admin", keys: [{ id: fakeKeyId("alice"), ageDays: 30, active: true }] },
      { name: "old-integration", keys: [{ id: fakeKeyId("oldint"), ageDays: 700, active: false }] },
    ],
  },
  trails: [{ name: "org-trail", homeRegion: "us-east-1", multiRegion: true, logging: true }],
  guardduty: {
    "us-east-1": [
      { id: "gd-fixture-0001", type: "UnauthorizedAccess:EC2/SSHBruteForce", severity: 5, title: "Possible SSH brute force against bastion", resourceType: "Instance", daysAgo: 1 },
      { id: "gd-fixture-0002", type: "Recon:EC2/PortProbeUnprotectedPort", severity: 2, title: "Unprotected port probed on web-1", resourceType: "Instance", daysAgo: 4 },
    ],
    "us-west-2": "disabled",
    "eu-west-1": [],
  },
  securityhub: {
    "us-east-1": [
      { id: "arn:aws:securityhub:us-east-1:123456789012:finding/fixture-0001", title: "S3 general purpose buckets should block public access", severity: "HIGH", resourceId: "arn:aws:s3:::acme-public-website", daysAgo: 2 },
      { id: "arn:aws:securityhub:us-east-1:123456789012:finding/fixture-0002", title: "RDS DB instances should prohibit public access", severity: "CRITICAL", resourceId: "arn:aws:rds:us-east-1:123456789012:db:legacy-mysql", daysAgo: 2 },
    ],
    "us-west-2": "disabled",
    "eu-west-1": "disabled",
  },
  cost: {
    baseDaily: 412,
    services: [
      ["Amazon Elastic Compute Cloud - Compute", 0.34],
      ["Amazon Relational Database Service", 0.21],
      ["Amazon Simple Storage Service", 0.09],
      ["Amazon Elastic Container Service", 0.08],
      ["AWS Lambda", 0.05],
      ["Amazon DynamoDB", 0.06],
      ["Amazon CloudFront", 0.04],
      ["Amazon Virtual Private Cloud", 0.05],
      ["Amazon CloudWatch", 0.03],
      ["Tax", 0.05],
    ],
    regions: [["us-east-1", 0.71], ["eu-west-1", 0.19], ["us-west-2", 0.06], ["global", 0.04]],
  },
};

const STAGING: FxWorld = {
  ...emptyWorld(["us-east-1", "us-west-2"]),
  failingRegions: { "us-west-2": "ServiceUnavailable" },
  instances: [
    { id: "i-0stg000000000001", name: "staging-app", region: "us-east-1", az: "us-east-1a", type: "t3.small", arch: "x86_64", state: "running", launchedDaysAgo: 20, vpcId: "vpc-0stg00001", subnetId: "subnet-0stg0001a", sgIds: ["sg-0stg00001"], privateIp: "10.50.1.10", volumeIds: [], cpuAvg: 9, tags: { env: "staging" } },
    { id: "i-0stg000000000002", name: "staging-worker", region: "us-east-1", az: "us-east-1a", type: "t3.small", arch: "x86_64", state: "stopped", stoppedDaysAgo: 12, launchedDaysAgo: 25, vpcId: "vpc-0stg00001", subnetId: "subnet-0stg0001a", sgIds: ["sg-0stg00001"], privateIp: "10.50.1.11", volumeIds: [], cpuAvg: 0 },
  ],
  vpcs: [{ id: "vpc-0stg00001", region: "us-east-1", cidr: "10.50.0.0/16", name: "staging-vpc", isDefault: false }],
  subnets: [{ id: "subnet-0stg0001a", region: "us-east-1", vpcId: "vpc-0stg00001", az: "us-east-1a", cidr: "10.50.1.0/24", name: "staging-a", public: false }],
  securityGroups: [{ id: "sg-0stg00001", region: "us-east-1", vpcId: "vpc-0stg00001", name: "staging-sg", ingress: [{ proto: "tcp", from: 443, to: 443, cidr: "10.0.0.0/8" }] }],
  buckets: [{ name: "acme-staging-artifacts", region: "us-east-1", createdDaysAgo: 100, sse: "AES256", versioning: "Enabled", pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, policyPublic: false, aclAllUsers: false, logging: false, lifecycle: true }],
  accountPab: true,
  lambdas: [{ name: "staging-api", region: "us-east-1", runtime: "nodejs20.x", memory: 512, timeout: 15, arch: "arm64", modifiedDaysAgo: 1, layers: 0 }],
  cost: { baseDaily: 38, services: [["Amazon Elastic Compute Cloud - Compute", 0.6], ["Amazon Simple Storage Service", 0.2], ["AWS Lambda", 0.2]], regions: [["us-east-1", 1]] },
};

const LIMITED: FxWorld = {
  ...emptyWorld(["us-east-1"]),
  denied: ["ce:*", "iam:*", "guardduty:*", "rds:*", "cloudtrail:*"],
  notEnabled: ["securityhub:*"],
  instances: [
    { id: "i-0lim000000000001", name: "legacy-app", region: "us-east-1", az: "us-east-1c", type: "m5.large", arch: "x86_64", state: "running", launchedDaysAgo: 900, vpcId: "vpc-0lim00001", subnetId: "subnet-0lim0001c", sgIds: ["sg-0lim00001"], publicIp: "203.0.113.77", privateIp: "172.31.5.5", volumeIds: [], cpuAvg: 15 },
  ],
  vpcs: [{ id: "vpc-0lim00001", region: "us-east-1", cidr: "172.31.0.0/16", name: "default", isDefault: true }],
  subnets: [{ id: "subnet-0lim0001c", region: "us-east-1", vpcId: "vpc-0lim00001", az: "us-east-1c", cidr: "172.31.0.0/20", name: "default-c", public: true }],
  securityGroups: [{ id: "sg-0lim00001", region: "us-east-1", vpcId: "vpc-0lim00001", name: "default", ingress: [{ proto: "tcp", from: 22, to: 22, cidr: "0.0.0.0/0" }] }],
  buckets: [{ name: "limited-uploads", region: "us-east-1", createdDaysAgo: 50, sse: "AES256", versioning: null, pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, policyPublic: false, aclAllUsers: false, logging: false, lifecycle: false }],
  cost: "denied",
};

function emptyWorld(regions: string[]): FxWorld {
  return {
    regions,
    instances: [], volumes: [], snapshots: [], addresses: [], vpcs: [], subnets: [], igws: [], nats: [], routeTables: [],
    securityGroups: [], nacls: [], vpcEndpoints: [], buckets: [], accountPab: false, rds: [], rdsClusters: [], dynamo: [],
    lambdas: [], ecsClusters: [], eksClusters: [], ecrRepos: [], loadBalancers: [], cloudfront: [], hostedZones: [],
    restApis: [], httpApis: [], topics: [], queues: [],
    iam: { mfaRoot: false, rootKeys: false, passwordPolicy: false, users: [] },
    trails: [], guardduty: {}, securityhub: {}, cost: { baseDaily: 0, services: [], regions: [] },
  };
}

export const WORLDS: Record<string, FxWorld> = {
  [FIXTURE_ACCOUNTS.PROD]: PROD,
  [FIXTURE_ACCOUNTS.STAGING]: STAGING,
  [FIXTURE_ACCOUNTS.LIMITED]: LIMITED,
};

/** Deterministic PRNG so fixture metrics/costs are stable across runs. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
