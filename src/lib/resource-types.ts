/**
 * Normalised resource model (client-safe). Every attribute stored in AwsResource.attributes is
 * produced by an explicit allow-list normaliser in src/server/aws/collectors — raw AWS responses
 * are never stored, so fields like Lambda environment variables or RDS master usernames can
 * never reach the database.
 */

export const RESOURCE_TYPES = {
  EC2_INSTANCE: "ec2:instance",
  EBS_VOLUME: "ec2:volume",
  EBS_SNAPSHOT: "ec2:snapshot",
  ELASTIC_IP: "ec2:elastic-ip",
  VPC: "ec2:vpc",
  SUBNET: "ec2:subnet",
  ROUTE_TABLE: "ec2:route-table",
  INTERNET_GATEWAY: "ec2:internet-gateway",
  NAT_GATEWAY: "ec2:nat-gateway",
  SECURITY_GROUP: "ec2:security-group",
  NETWORK_ACL: "ec2:network-acl",
  VPC_ENDPOINT: "ec2:vpc-endpoint",
  S3_BUCKET: "s3:bucket",
  RDS_INSTANCE: "rds:db-instance",
  RDS_CLUSTER: "rds:db-cluster",
  DYNAMODB_TABLE: "dynamodb:table",
  LAMBDA_FUNCTION: "lambda:function",
  ECS_CLUSTER: "ecs:cluster",
  ECS_SERVICE: "ecs:service",
  EKS_CLUSTER: "eks:cluster",
  ECR_REPOSITORY: "ecr:repository",
  LOAD_BALANCER: "elb:load-balancer",
  CLOUDFRONT_DISTRIBUTION: "cloudfront:distribution",
  ROUTE53_ZONE: "route53:hosted-zone",
  APIGW_REST_API: "apigateway:rest-api",
  APIGW_HTTP_API: "apigateway:http-api",
  SNS_TOPIC: "sns:topic",
  SQS_QUEUE: "sqs:queue",
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];
export const ALL_RESOURCE_TYPES: readonly ResourceType[] = Object.values(RESOURCE_TYPES);

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  "ec2:instance": "EC2 instance",
  "ec2:volume": "EBS volume",
  "ec2:snapshot": "EBS snapshot",
  "ec2:elastic-ip": "Elastic IP",
  "ec2:vpc": "VPC",
  "ec2:subnet": "Subnet",
  "ec2:route-table": "Route table",
  "ec2:internet-gateway": "Internet gateway",
  "ec2:nat-gateway": "NAT gateway",
  "ec2:security-group": "Security group",
  "ec2:network-acl": "Network ACL",
  "ec2:vpc-endpoint": "VPC endpoint",
  "s3:bucket": "S3 bucket",
  "rds:db-instance": "RDS instance",
  "rds:db-cluster": "Aurora cluster",
  "dynamodb:table": "DynamoDB table",
  "lambda:function": "Lambda function",
  "ecs:cluster": "ECS cluster",
  "ecs:service": "ECS service",
  "eks:cluster": "EKS cluster",
  "ecr:repository": "ECR repository",
  "elb:load-balancer": "Load balancer",
  "cloudfront:distribution": "CloudFront distribution",
  "route53:hosted-zone": "Route 53 zone",
  "apigateway:rest-api": "API Gateway REST API",
  "apigateway:http-api": "API Gateway HTTP API",
  "sns:topic": "SNS topic",
  "sqs:queue": "SQS queue",
};

/** A configuration value we tried to read: either observed, or unknown with a reason. */
export type Observed<T> = { ok: true; value: T } | { ok: false; reason: "access_denied" | "not_found" | "error" };

export interface Ec2InstanceAttrs {
  instanceType: string;
  architecture: string | null;
  availabilityZone: string | null;
  publicIp: string | null;
  privateIp: string | null;
  vpcId: string | null;
  subnetId: string | null;
  securityGroups: { id: string; name: string | null }[];
  iamInstanceProfileArn: string | null;
  launchTime: string | null;
  platform: string | null;
  monitoring: string | null;
  volumeIds: string[];
  stateReason: string | null;
  /** Parsed from the state-transition reason when AWS provides a timestamp. */
  stoppedAt: string | null;
}

export interface EbsVolumeAttrs {
  sizeGiB: number;
  volumeType: string | null;
  encrypted: boolean;
  availabilityZone: string | null;
  attachedInstanceIds: string[];
  createTime: string | null;
}

export interface EbsSnapshotAttrs {
  volumeId: string | null;
  sizeGiB: number;
  startTime: string | null;
  encrypted: boolean;
}

export interface ElasticIpAttrs {
  publicIp: string | null;
  allocationId: string | null;
  instanceId: string | null;
  associationId: string | null;
}

export interface VpcAttrs {
  cidr: string | null;
  isDefault: boolean;
}
export interface SubnetAttrs {
  vpcId: string | null;
  availabilityZone: string | null;
  cidr: string | null;
  mapPublicIpOnLaunch: boolean;
  availableIps: number | null;
}
export interface RouteTableAttrs {
  vpcId: string | null;
  subnetIds: string[];
  main: boolean;
  routes: { destination: string; target: string; targetType: "local" | "igw" | "nat" | "other" }[];
}
export interface InternetGatewayAttrs {
  vpcIds: string[];
}
export interface NatGatewayAttrs {
  vpcId: string | null;
  subnetId: string | null;
  publicIps: string[];
}
export interface SgRuleSource {
  type: "cidr" | "ipv6" | "sg" | "prefix-list";
  value: string;
}
export interface SecurityGroupRule {
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  sources: SgRuleSource[];
}
export interface SecurityGroupAttrs {
  vpcId: string | null;
  description: string | null;
  ingress: SecurityGroupRule[];
  egressRuleCount: number;
}
export interface NetworkAclAttrs {
  vpcId: string | null;
  isDefault: boolean;
  subnetIds: string[];
  entryCount: number;
}
export interface VpcEndpointAttrs {
  vpcId: string | null;
  serviceName: string | null;
  endpointType: string | null;
}

export interface PublicAccessBlock {
  blockPublicAcls: boolean;
  ignorePublicAcls: boolean;
  blockPublicPolicy: boolean;
  restrictPublicBuckets: boolean;
}

export interface S3BucketAttrs {
  creationDate: string | null;
  encryption: Observed<{ algorithm: string; kmsKeyId: string | null; bucketKeyEnabled: boolean } | null>;
  versioning: Observed<"Enabled" | "Suspended" | "Disabled">;
  /** null value = no bucket-level configuration exists. */
  publicAccessBlock: Observed<PublicAccessBlock | null>;
  accountPublicAccessBlock: Observed<PublicAccessBlock | null>;
  /** AWS's own policy evaluation; null = bucket has no policy. */
  policyIsPublic: Observed<boolean | null>;
  /** e.g. ["AllUsers:READ"] */
  aclPublicGrants: Observed<string[]>;
  logging: Observed<{ enabled: boolean; targetBucket: string | null }>;
  lifecycleRuleCount: Observed<number>;
}

export interface RdsInstanceAttrs {
  engine: string;
  engineVersion: string | null;
  instanceClass: string | null;
  allocatedStorageGiB: number | null;
  encrypted: boolean;
  publiclyAccessible: boolean;
  multiAz: boolean;
  backupRetentionDays: number;
  vpcId: string | null;
  subnetIds: string[];
  securityGroupIds: string[];
  endpointAddress: string | null;
  endpointPort: number | null;
  clusterId: string | null;
  availabilityZone: string | null;
}
export interface RdsClusterAttrs {
  engine: string;
  engineVersion: string | null;
  engineMode: string | null;
  encrypted: boolean;
  memberIds: string[];
}
export interface DynamoTableAttrs {
  billingMode: string;
  readCapacity: number | null;
  writeCapacity: number | null;
  itemCount: number | null;
  sizeBytes: number | null;
  sseType: string | null;
  pointInTimeRecovery: Observed<boolean>;
  createdAt: string | null;
}
export interface LambdaAttrs {
  runtime: string | null;
  memoryMb: number | null;
  timeoutSec: number | null;
  architecture: string | null;
  lastModified: string | null;
  vpcId: string | null;
  layerCount: number;
  packageType: string | null;
  codeSizeBytes: number | null;
  /** Count only — variable names/values are never stored. */
  environmentVariableCount: number;
}
export interface EcsClusterAttrs {
  runningTasks: number;
  pendingTasks: number;
  activeServices: number;
  containerInstances: number;
}
export interface EcsServiceAttrs {
  clusterName: string | null;
  desiredCount: number;
  runningCount: number;
  launchType: string | null;
}
export interface EksClusterAttrs {
  version: string | null;
  platformVersion: string | null;
  endpointPublicAccess: boolean;
  endpointPrivateAccess: boolean;
  publicAccessCidrs: string[];
  vpcId: string | null;
  createdAt: string | null;
}
export interface EcrRepositoryAttrs {
  imageCount: number | null;
  scanOnPush: boolean;
  tagMutability: string | null;
  encryptionType: string | null;
  latestScan: { critical: number; high: number } | null;
  createdAt: string | null;
}
export interface LoadBalancerAttrs {
  lbType: string;
  scheme: string | null;
  dnsName: string | null;
  vpcId: string | null;
  subnetIds: string[];
  securityGroupIds: string[];
  createdAt: string | null;
}
export interface GenericAttrs {
  [key: string]: string | number | boolean | null | string[];
}
