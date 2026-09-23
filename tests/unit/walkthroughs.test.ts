import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_REGIONS } from "@/lib/regions";
import { consoleUrl, getWalkthrough, hasUnresolvedTokens, resolveTokens, WALKTHROUGHS, walkthroughForRule } from "@/lib/walkthroughs";

describe("walkthrough catalogue", () => {
  it("has unique ids and non-empty steps", () => {
    const ids = new Set<string>();
    for (const w of WALKTHROUGHS) {
      expect(ids.has(w.id), `duplicate id ${w.id}`).toBe(false);
      ids.add(w.id);
      expect(w.steps.length).toBeGreaterThan(0);
      expect(w.summary.length).toBeGreaterThan(20);
      for (const step of w.steps) expect(step.actions.length, `${w.id} / ${step.title}`).toBeGreaterThan(0);
    }
  });

  it("covers every security rule the analyser can raise", () => {
    // Read the rule source so adding a rule without a fix walkthrough fails here rather than
    // silently shipping a finding nobody is told how to fix.
    const source = readFileSync(new URL("../../src/server/rules/security-rules.ts", import.meta.url), "utf8");
    const ruleIds = [...source.matchAll(/ruleId: "([A-Z0-9-]+)"/g)].map((m) => m[1]!);
    expect(ruleIds.length).toBeGreaterThan(10);
    const missing = [...new Set(ruleIds)].filter((id) => !walkthroughForRule(id));
    expect(missing, `security rules with no walkthrough: ${missing.join(", ")}`).toEqual([]);
  });

  it("never suggests opening a port to the whole internet", () => {
    for (const w of WALKTHROUGHS) {
      for (const step of w.steps) {
        for (const field of step.fields ?? []) {
          expect(field.value, `${w.id} / ${field.label}`).not.toMatch(/^0\.0\.0\.0\/0$/);
          expect(field.value).not.toMatch(/^::\/0$/);
        }
      }
    }
  });

  it("links only to AWS documentation hosts", () => {
    for (const w of WALKTHROUGHS) {
      for (const doc of w.docs ?? []) {
        const host = new URL(doc.url).hostname;
        expect(host === "docs.aws.amazon.com" || host === "aws.amazon.com", `${w.id}: ${host}`).toBe(true);
        expect(new URL(doc.url).protocol).toBe("https:");
      }
    }
  });

  it("only references console targets that resolve to a real AWS console URL", () => {
    for (const w of WALKTHROUGHS) {
      for (const step of w.steps) {
        if (!step.target) continue;
        // Resource ids inside targets are tokens resolved at render time; substitute a valid one.
        const target = { ...step.target, resource: step.target.resource ? "i-0123456789abcdef0" : undefined };
        const url = consoleUrl(target, "eu-west-1");
        expect(url, `${w.id} / ${step.title} has an unknown console target`).not.toBeNull();
        expect(new URL(url!).hostname).toMatch(/\.?console\.aws\.amazon\.com$/);
      }
    }
  });
});

describe("console deep links", () => {
  it("builds a region-scoped URL for a known region", () => {
    expect(consoleUrl({ service: "ec2", view: "instances" }, "ap-south-1")).toBe("https://ap-south-1.console.aws.amazon.com/ec2/home?region=ap-south-1#Instances:");
  });

  it("refuses an unknown region rather than building a hostname from it", () => {
    expect(consoleUrl({ service: "ec2", view: "instances" }, "evil.example.com")).toBeNull();
    expect(consoleUrl({ service: "ec2", view: "instances" }, "us-east-1.attacker.net")).toBeNull();
    expect(consoleUrl({ service: "ec2", view: "instances" }, "")).toBeNull();
  });

  it("refuses an unknown service or view", () => {
    expect(consoleUrl({ service: "ec2", view: "notAView" }, "us-east-1")).toBeNull();
    expect(consoleUrl({ service: "nope" as never, view: "instances" }, "us-east-1")).toBeNull();
  });

  it("refuses a resource id that is not a shape we recognise", () => {
    expect(consoleUrl({ service: "ec2", view: "instance", resource: "i-0123456789abcdef0" }, "us-east-1")).toContain("instanceId=i-0123456789abcdef0");
    expect(consoleUrl({ service: "ec2", view: "instance", resource: "../../evil" }, "us-east-1")).toBeNull();
    expect(consoleUrl({ service: "ec2", view: "instance", resource: "{{resourceId}}" }, "us-east-1")).toBeNull();
    expect(consoleUrl({ service: "ec2", view: "instance" }, "us-east-1")).toBeNull();
  });

  it("produces a valid https URL for every known region", () => {
    for (const region of KNOWN_REGIONS) {
      const url = consoleUrl({ service: "vpc", view: "vpcs" }, region);
      expect(url).not.toBeNull();
      expect(new URL(url!).protocol).toBe("https:");
    }
  });
});

describe("token resolution", () => {
  it("substitutes known values", () => {
    expect(resolveTokens("Set VPC to {{vpcId}} in {{region}}.", { vpcId: "vpc-0abc", region: "eu-west-2" })).toBe("Set VPC to vpc-0abc in eu-west-2.");
  });

  it("shows a visible hint instead of inventing a plausible id", () => {
    const out = resolveTokens("Set VPC to {{vpcId}}.", {});
    expect(out).toContain("[your VPC id");
    expect(out).not.toMatch(/vpc-[0-9a-f]/);
    expect(hasUnresolvedTokens("Set VPC to {{vpcId}}.", {})).toBe(true);
    expect(hasUnresolvedTokens("Set VPC to {{vpcId}}.", { vpcId: "vpc-1" })).toBe(false);
  });

  it("leaves unrecognised tokens untouched rather than blanking them", () => {
    expect(resolveTokens("Keep {{notAToken}} as is.", {})).toBe("Keep {{notAToken}} as is.");
  });

  it("does not let a resolved value inject another token", () => {
    expect(resolveTokens("{{vpcId}}", { vpcId: "{{region}}", region: "us-east-1" })).toBe("{{region}}");
  });
});

describe("walkthrough lookup", () => {
  it("finds the S3 public-access fix by rule id", () => {
    expect(walkthroughForRule("S3-PUBLIC")?.id).toBe("fix-s3-public-access");
    expect(walkthroughForRule("S3-BPA-OFF")?.id).toBe("fix-s3-public-access");
    expect(walkthroughForRule("NOT-A-RULE")).toBeUndefined();
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    expect(getWalkthrough("../../etc/passwd")).toBeUndefined();
    expect(getWalkthrough("ec2-launch-instance")?.category).toBe("launch");
  });
});
