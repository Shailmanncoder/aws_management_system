import { describe, expect, it } from "vitest";
import type { SecuritySignals } from "@/server/aws/security-signals";
import { evaluateAccountSignals, RESOURCE_RULES, type RuleResource } from "@/server/rules/security-rules";
import { findingFingerprint, hasUnknownObservation } from "@/server/sync/security-sync";

const unavailable = { ok: false, reason: "access_denied" } as const;
const signals = (): SecuritySignals => ({ accountSummary: unavailable, passwordPolicy: unavailable, accessKeys: unavailable, trails: unavailable, guardDuty: {}, securityHub: {}, externalFindings: [] });
const resource = (resourceType: string, attributes: unknown): RuleResource => ({ id: "resource", resourceType, resourceId: "test", region: "us-east-1", name: null, attributes });
const evaluate = (r: RuleResource) => RESOURCE_RULES.filter((rule) => rule.resourceType === r.resourceType).flatMap((rule) => rule.evaluate(r));

describe("security rules and missing evidence", () => {
  it("does not fabricate account findings or completed checks from denied reads", () => {
    expect(evaluateAccountSignals(signals(), "us-east-1")).toEqual({ drafts: [], ranChecks: [] });
  });
  it("does not declare CloudTrail inactive when its logging status is unavailable", () => {
    const s = signals();
    s.trails = { ok: true, value: [{ name: "audit", multiRegion: true, logging: null, homeRegion: "us-east-1" }] };
    expect(evaluateAccountSignals(s, "us-east-1").ranChecks).not.toContain("CLOUDTRAIL");
    expect(evaluateAccountSignals(s, "us-east-1").drafts).toHaveLength(0);
  });
  it("reports confirmed root risks with evidence and remediation", () => {
    const s = signals();
    s.accountSummary = { ok: true, value: { rootMfaEnabled: false, rootAccessKeysPresent: true } };
    const result = evaluateAccountSignals(s, "us-east-1");
    expect(result.drafts.map((d) => d.ruleId)).toEqual(["IAM-ROOT-MFA", "IAM-ROOT-KEYS"]);
    for (const d of result.drafts) { expect(d.severity).toBe("CRITICAL"); expect(d.remediation).toBeTruthy(); expect(Object.keys(d.evidence).length).toBeGreaterThan(0); }
  });
  it("scopes GuardDuty completed checks to the same rule and region as the finding", () => {
    const s = signals(); s.guardDuty["us-east-1"] = { ok: true, value: { enabled: false } };
    const result = evaluateAccountSignals(s, "us-east-1");
    expect(result.ranChecks).toContain(`${result.drafts[0]!.ruleId}|us-east-1`);
  });
  it("requires confirmed unencrypted queue data", () => {
    expect(evaluate(resource("sqs:queue", {}))).toEqual([]);
    expect(evaluate(resource("sqs:queue", { encryption: "none" }))[0]?.ruleId).toBe("SQS-UNENCRYPTED");
  });
  it("does not infer object encryption from absence of an S3 default configuration", () => {
    expect(RESOURCE_RULES.some((r) => r.id === "S3-NO-ENCRYPTION")).toBe(false);
  });
  it("detects nested unavailable evidence so it cannot resolve previous risks", () => {
    expect(hasUnknownObservation({ data: [{ setting: unavailable }] })).toBe(true);
    expect(hasUnknownObservation({ data: { ok: true, value: false } })).toBe(false);
  });
  it("fingerprints are stable and separate account, source and region subjects", () => {
    const fp = findingFingerprint("a", "STRATUS_RULE", "rule", "region|resource");
    expect(findingFingerprint("a", "STRATUS_RULE", "rule", "region|resource")).toBe(fp);
    expect(findingFingerprint("b", "STRATUS_RULE", "rule", "region|resource")).not.toBe(fp);
    expect(findingFingerprint("a", "GUARDDUTY", "rule", "region|resource")).not.toBe(fp);
  });
});
