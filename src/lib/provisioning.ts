import { z } from "zod";
import { describeCidrProblem } from "./cidr";

export const guardrailSchema = z.strictObject({
  allowedRegions: z
    .array(z.string().regex(/^[a-z]{2}-[a-z]+-\d$/))
    .min(1)
    .max(30)
    .default(["ap-south-1", "us-east-1"]),
  allowedInstanceTypes: z
    .array(z.enum(["t3.micro", "t3.small", "t4g.micro"]))
    .min(1)
    .default(["t3.micro", "t3.small", "t4g.micro"]),
  maxInstances: z.number().int().min(1).max(100).default(5),
  maxStorageGiB: z.number().int().min(8).max(1000).default(100),
  requireEncryption: z.literal(true).default(true),
  allowPublicIpv4: z.boolean().default(false),
  allowPublicS3: z.literal(false).default(false),
  /** Networks Stratus may create per connection. VPCs are free but count against an AWS quota. */
  maxVpcs: z.number().int().min(1).max(50).default(5),
});
export type Guardrails = z.infer<typeof guardrailSchema>;
export const DEFAULT_GUARDRAILS = guardrailSchema.parse({});
const safeText = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/,
    "Use letters, numbers, spaces, dots, underscores or hyphens; no personal information or secrets.",
  );
export const bucketNameSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Use lowercase letters, numbers and hyphens.",
  )
  .refine(
    (v) =>
      !v.startsWith("xn--") &&
      !v.startsWith("sthree-") &&
      !v.startsWith("amzn-s3-demo-") &&
      !/(--ol-s3|--x-s3|--table-s3|-s3alias|\.mrap)$/.test(v),
    "Reserved bucket name.",
  );
const common = {
  accountId: z.uuid(),
  region: z.string().min(1).max(30),
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
  tags: z
    .array(
      z.strictObject({
        key: safeText.refine(
          (k) =>
            !/^(aws:|ManagedBy$|CreatedBy$|ConnectionId$|Environment$|Name$)/i.test(
              k,
            ) && !/secret|password|token|credential|email|accesskey/i.test(k),
          "Reserved or sensitive tag key",
        ),
        value: safeText,
      }),
    )
    .max(10)
    .default([])
    .refine(
      (v) => new Set(v.map((t) => t.key)).size === v.length,
      "Duplicate tag keys",
    ),
};
/** AWS accepts /16 to /28 for both VPC and subnet IPv4 blocks. */
const cidrSchema = z
  .string()
  .trim()
  .max(18)
  .superRefine((value, ctx) => {
    const problem = describeCidrProblem(value, { min: 16, max: 28 });
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const configurationSchema = z.discriminatedUnion("service", [
  z.strictObject({
    ...common,
    service: z.literal("ec2"),
    name: safeText,
    operatingSystem: z
      .literal("amazon-linux-2023")
      .default("amazon-linux-2023"),
    architecture: z.enum(["x86_64", "arm64"]),
    instanceType: z.enum(["t3.micro", "t3.small", "t4g.micro"]),
    vpcId: z.string().regex(/^vpc-[a-f0-9]{8,17}$/),
    subnetId: z.string().regex(/^subnet-[a-f0-9]{8,17}$/),
    securityGroupIds: z
      .array(z.string().regex(/^sg-[a-f0-9]{8,17}$/))
      .min(1)
      .max(5),
    storageGiB: z.number().int().min(8).max(1000),
    storageType: z.literal("gp3").default("gp3"),
    encrypted: z.literal(true).default(true),
    publicIpv4: z.boolean().default(false),
    keyName: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,64}$/)
      .optional(),
  }),
  z.strictObject({
    ...common,
    service: z.literal("s3"),
    name: bucketNameSchema,
    versioning: z.boolean().default(true),
    encryption: z.literal("AES256").default("AES256"),
  }),
  z.strictObject({
    ...common,
    service: z.literal("vpc"),
    name: safeText,
    cidr: cidrSchema,
    /** DNS support is required for VPC endpoints and for most AWS service integrations. */
    enableDnsSupport: z.literal(true).default(true),
    enableDnsHostnames: z.boolean().default(true),
  }),
  z.strictObject({
    ...common,
    service: z.literal("subnet"),
    name: safeText,
    vpcId: z.string().regex(/^vpc-[a-f0-9]{8,17}$/),
    cidr: cidrSchema,
    /** Omitted means AWS chooses; an explicit zone is validated against the region. */
    availabilityZone: z
      .string()
      .regex(/^[a-z]{2}-[a-z]+-\d[a-z]$/)
      .optional(),
    /**
     * Auto-assigning a public IP is what makes a subnet "public" for anything launched in it.
     * Stratus never creates one: a public subnet is a deliberate act done with routing.
     */
    mapPublicIpOnLaunch: z.literal(false).default(false),
  }),
]);
export type Configuration = z.infer<typeof configurationSchema>;
export const planInput = z.strictObject({
  idempotencyKey: z.uuid(),
  configuration: configurationSchema,
});
export const applyInput = z.strictObject({
  confirmation: z.string().min(1).max(64),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeExposure: z.boolean().default(false),
});
export type Review = {
  name: string;
  service: string;
  region: string;
  configuration: Configuration;
  tags: Record<string, string>;
  imageId?: string;
  rootDeviceName?: string;
  vcpu?: number;
  memoryMiB?: number;
  estimatedMonthlyUsd: number | null;
  /** Subnet/VPC planning detail: usable addresses and the zone AWS will place it in. */
  usableAddresses?: number;
  availabilityZone?: string;
  warnings: string[];
  requiredPermissions: string[];
  networkExposure: string;
};
