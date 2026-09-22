import type { Observed, PublicAccessBlock, S3BucketAttrs } from "./resource-types";

/**
 * S3 exposure assessment (client-safe, shared by UI and security rules).
 *
 * A bucket is only classified PUBLIC when two independent signals agree:
 *   1. a public grant exists (AWS's own bucket-policy evaluation says public, or the ACL grants
 *      AllUsers/AuthenticatedUsers), AND
 *   2. no effective Block Public Access setting neutralises that grant.
 * Unknown signals (e.g. access denied) produce UNKNOWN — never a guess.
 */
export type ExposureLevel = "public" | "not-blocked" | "blocked" | "unknown";

export interface ExposureAssessment {
  level: ExposureLevel;
  reasons: string[];
  signals: { label: string; value: string; kind: "risk" | "ok" | "unknown" }[];
}

const val = <T,>(o: Observed<T>): T | undefined => (o.ok ? o.value : undefined);

function effectiveFlag(bucket: PublicAccessBlock | null | undefined, account: PublicAccessBlock | null | undefined, key: keyof PublicAccessBlock): boolean {
  return Boolean(bucket?.[key]) || Boolean(account?.[key]);
}

export function assessBucketExposure(a: S3BucketAttrs): ExposureAssessment {
  const signals: ExposureAssessment["signals"] = [];
  const reasons: string[] = [];

  const pabKnown = a.publicAccessBlock.ok && a.accountPublicAccessBlock.ok;
  const bucketPab = val(a.publicAccessBlock);
  const accountPab = val(a.accountPublicAccessBlock);
  const restrictPolicy = effectiveFlag(bucketPab, accountPab, "restrictPublicBuckets");
  const ignoreAcls = effectiveFlag(bucketPab, accountPab, "ignorePublicAcls");
  const blockNewPolicy = effectiveFlag(bucketPab, accountPab, "blockPublicPolicy");
  const blockNewAcls = effectiveFlag(bucketPab, accountPab, "blockPublicAcls");
  const fullyBlocked = restrictPolicy && ignoreAcls && blockNewPolicy && blockNewAcls;

  signals.push({
    label: "Block Public Access (bucket)",
    value: !a.publicAccessBlock.ok ? `unknown (${a.publicAccessBlock.reason})` : bucketPab ? summarizePab(bucketPab) : "not configured",
    kind: !a.publicAccessBlock.ok ? "unknown" : bucketPab && allOn(bucketPab) ? "ok" : "risk",
  });
  signals.push({
    label: "Block Public Access (account)",
    value: !a.accountPublicAccessBlock.ok ? `unknown (${a.accountPublicAccessBlock.reason})` : accountPab ? summarizePab(accountPab) : "not configured",
    kind: !a.accountPublicAccessBlock.ok ? "unknown" : accountPab && allOn(accountPab) ? "ok" : "risk",
  });

  const policyPublic = val(a.policyIsPublic);
  signals.push({
    label: "Bucket policy (AWS evaluation)",
    value: !a.policyIsPublic.ok ? `unknown (${a.policyIsPublic.reason})` : policyPublic === null ? "no bucket policy" : policyPublic ? "grants public access" : "not public",
    kind: !a.policyIsPublic.ok ? "unknown" : policyPublic ? "risk" : "ok",
  });
  const aclGrants = val(a.aclPublicGrants);
  signals.push({
    label: "ACL public grants",
    value: !a.aclPublicGrants.ok ? `unknown (${a.aclPublicGrants.reason})` : aclGrants && aclGrants.length ? aclGrants.join(", ") : "none",
    kind: !a.aclPublicGrants.ok ? "unknown" : aclGrants && aclGrants.length ? "risk" : "ok",
  });

  const effectivePolicyPublic = policyPublic === true && !restrictPolicy;
  const effectiveAclPublic = Boolean(aclGrants && aclGrants.length > 0) && !ignoreAcls;

  if (pabKnown && fullyBlocked) {
    reasons.push("All four Block Public Access settings are effective (bucket or account level), which overrides public policies and ACLs.");
    return { level: "blocked", reasons, signals };
  }
  if (effectivePolicyPublic || effectiveAclPublic) {
    if (!pabKnown) {
      reasons.push("A public grant was detected, but Block Public Access settings could not be read, so effective exposure cannot be confirmed.");
      return { level: "unknown", reasons, signals };
    }
    if (effectivePolicyPublic) reasons.push("AWS evaluates the bucket policy as public and RestrictPublicBuckets is not enabled at bucket or account level.");
    if (effectiveAclPublic) reasons.push(`The ACL grants ${aclGrants!.join(", ")} and IgnorePublicAcls is not enabled at bucket or account level.`);
    return { level: "public", reasons, signals };
  }
  if (!a.policyIsPublic.ok || !a.aclPublicGrants.ok || !pabKnown) {
    reasons.push("Some access-control signals could not be read (see evidence); exposure cannot be determined.");
    return { level: "unknown", reasons, signals };
  }
  reasons.push("No public policy or ACL grant was found, but Block Public Access is not fully enabled, so a future policy or ACL change could expose data.");
  return { level: "not-blocked", reasons, signals };
}

function allOn(p: PublicAccessBlock): boolean {
  return p.blockPublicAcls && p.ignorePublicAcls && p.blockPublicPolicy && p.restrictPublicBuckets;
}

function summarizePab(p: PublicAccessBlock): string {
  if (allOn(p)) return "all 4 enabled";
  const on = Object.entries(p).filter(([, v]) => v).map(([k]) => k);
  return on.length ? `partial (${on.join(", ")})` : "all disabled";
}

export const EXPOSURE_LABELS: Record<ExposureLevel, string> = {
  public: "Public",
  "not-blocked": "Not blocked",
  blocked: "Blocked",
  unknown: "Unknown",
};
