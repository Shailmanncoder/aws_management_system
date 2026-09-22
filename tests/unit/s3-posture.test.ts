import { describe, expect, it } from "vitest";
import type { Observed, PublicAccessBlock, S3BucketAttrs } from "@/lib/resource-types";
import { assessBucketExposure } from "@/lib/s3-posture";

const ok = <T,>(value: T): Observed<T> => ({ ok: true, value });
const denied: Observed<never> = { ok: false, reason: "access_denied" };
const ON: PublicAccessBlock = { blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true };
const OFF: PublicAccessBlock = { blockPublicAcls: false, ignorePublicAcls: false, blockPublicPolicy: false, restrictPublicBuckets: false };

function bucket(over: Partial<S3BucketAttrs>): S3BucketAttrs {
  return {
    creationDate: null,
    encryption: ok({ algorithm: "AES256", kmsKeyId: null, bucketKeyEnabled: false }),
    versioning: ok("Enabled"),
    publicAccessBlock: ok(OFF),
    accountPublicAccessBlock: ok(null),
    policyIsPublic: ok(null),
    aclPublicGrants: ok([]),
    logging: ok({ enabled: true, targetBucket: "x" }),
    lifecycleRuleCount: ok(1),
    ...over,
  };
}

describe("S3 exposure assessment", () => {
  it("public requires a public grant AND no effective block (two signals)", () => {
    const r = assessBucketExposure(bucket({ policyIsPublic: ok(true) }));
    expect(r.level).toBe("public");
    expect(r.reasons.join(" ")).toMatch(/RestrictPublicBuckets/);
  });

  it("a missing Block Public Access alone is NOT reported as public", () => {
    expect(assessBucketExposure(bucket({})).level).toBe("not-blocked");
  });

  it("account-level block neutralises a public bucket policy", () => {
    expect(assessBucketExposure(bucket({ policyIsPublic: ok(true), accountPublicAccessBlock: ok(ON) })).level).toBe("blocked");
  });

  it("IgnorePublicAcls neutralises public ACLs but not public policies", () => {
    const acl = assessBucketExposure(bucket({ aclPublicGrants: ok(["AllUsers:READ"]), publicAccessBlock: ok({ ...OFF, ignorePublicAcls: true }) }));
    expect(acl.level).toBe("not-blocked");
    const policy = assessBucketExposure(bucket({ policyIsPublic: ok(true), publicAccessBlock: ok({ ...OFF, ignorePublicAcls: true }) }));
    expect(policy.level).toBe("public");
  });

  it("unreadable signals yield unknown, never a guess", () => {
    expect(assessBucketExposure(bucket({ policyIsPublic: denied })).level).toBe("unknown");
    expect(assessBucketExposure(bucket({ aclPublicGrants: ok(["AllUsers:READ"]), publicAccessBlock: denied })).level).toBe("unknown");
  });

  it("always explains evidence for each signal", () => {
    const r = assessBucketExposure(bucket({ policyIsPublic: ok(true) }));
    expect(r.signals.map((s) => s.label)).toEqual(["Block Public Access (bucket)", "Block Public Access (account)", "Bucket policy (AWS evaluation)", "ACL public grants"]);
  });
});
