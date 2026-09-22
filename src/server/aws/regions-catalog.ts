import { AppError } from "../errors";

/**
 * Known AWS commercial/GovCloud/China regions. Region strings from users, the DB or even AWS
 * responses are checked against this list before being used to build SDK endpoints, so no
 * value can steer requests to a non-AWS host. Update when AWS launches regions.
 */
export const KNOWN_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "af-south-1",
  "ap-east-1", "ap-east-2", "ap-south-1", "ap-south-2",
  "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4", "ap-southeast-5", "ap-southeast-6", "ap-southeast-7",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ca-central-1", "ca-west-1",
  "eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "eu-west-3",
  "eu-south-1", "eu-south-2", "eu-north-1",
  "il-central-1",
  "me-south-1", "me-central-1",
  "mx-central-1",
  "sa-east-1",
  "us-gov-east-1", "us-gov-west-1",
  "cn-north-1", "cn-northwest-1",
] as const;

const REGION_SET: ReadonlySet<string> = new Set(KNOWN_REGIONS);

export function isKnownRegion(region: unknown): region is string {
  return typeof region === "string" && REGION_SET.has(region);
}

export function assertKnownRegion(region: string): void {
  if (!isKnownRegion(region)) throw new AppError("VALIDATION_FAILED", "Unsupported AWS region.");
}

/** Region hosting global-service control planes for a partition (IAM, Cost Explorer, Route 53...). */
export function globalRegionFor(partition: string): string {
  if (partition === "aws-us-gov") return "us-gov-west-1";
  if (partition === "aws-cn") return "cn-northwest-1";
  return "us-east-1";
}
