import "server-only";
import { DescribeRegionsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { createAwsClient } from "./client-factory";
import { globalRegionFor, isKnownRegion } from "./regions-catalog";
import type { AwsSession } from "./session";

/**
 * Regions enabled for the account (opted-in or opt-in-not-required). Unknown region names in the
 * AWS response are dropped rather than trusted.
 */
export async function listEnabledRegions(session: AwsSession): Promise<string[]> {
  const ec2 = createAwsClient(EC2Client, session, globalRegionFor(session.partition), "ec2");
  try {
    const res = await ec2.send(new DescribeRegionsCommand({ AllRegions: false }));
    return (res.Regions ?? [])
      .filter((r) => r.OptInStatus !== "not-opted-in")
      .map((r) => r.RegionName)
      .filter(isKnownRegion)
      .sort();
  } finally {
    ec2.destroy();
  }
}

/** Effective scan set: enabled regions ∩ optional customer allowlist. */
export function effectiveRegions(enabled: readonly string[], allowlist: readonly string[]): string[] {
  const base = enabled.filter(isKnownRegion);
  if (allowlist.length === 0) return [...base];
  const allow = new Set(allowlist);
  return base.filter((r) => allow.has(r));
}
