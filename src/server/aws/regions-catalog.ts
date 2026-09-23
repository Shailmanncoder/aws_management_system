import { AppError } from "../errors";
import { isKnownRegion } from "@/lib/regions";

/**
 * Region validation for server-side use. The region list itself lives in `@/lib/regions` so the
 * client-side console deep links in the guided walkthroughs validate against exactly the same set.
 */
export { KNOWN_REGIONS, isKnownRegion } from "@/lib/regions";

export function assertKnownRegion(region: string): void {
  if (!isKnownRegion(region)) throw new AppError("VALIDATION_FAILED", "Unsupported AWS region.");
}

/** Region hosting global-service control planes for a partition (IAM, Cost Explorer, Route 53...). */
export function globalRegionFor(partition: string): string {
  if (partition === "aws-us-gov") return "us-gov-west-1";
  if (partition === "aws-cn") return "cn-northwest-1";
  return "us-east-1";
}
