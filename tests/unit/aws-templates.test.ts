import { describe, expect, it } from "vitest";
import { ACTION_PERMISSIONS, DATA_PLANE_DENY, READ_PERMISSIONS } from "@/server/aws/permissions";
import { actionPolicy, readOnlyPolicy, readOnlyRoleTemplate, trustPolicy } from "@/server/aws/templates";

const PRINCIPAL = "arn:aws:iam::111111111111:role/StratusPlatformRole";
const EXT = "stratus-" + "b".repeat(43);

describe("IAM templates", () => {
  it("trust policy requires the exact ExternalId and only the platform principal", () => {
    const t = trustPolicy(PRINCIPAL, EXT);
    const s = t.Statement[0] as { Principal: { AWS: string }; Condition: { StringEquals: Record<string, string> }; Action: string };
    expect(s.Principal.AWS).toBe(PRINCIPAL);
    expect(s.Action).toBe("sts:AssumeRole");
    expect(s.Condition.StringEquals["sts:ExternalId"]).toBe(EXT);
  });

  it("read-only policy contains no mutating or wildcard actions", () => {
    const actions = (readOnlyPolicy().Statement.flatMap((s) => [s.Action].flat()) as string[]);
    for (const a of actions) {
      expect(a).not.toMatch(/\*/);
      const verb = a.split(":")[1]!;
      expect(verb).toMatch(/^(Describe|List|Get|GET|Search)/);
      expect(verb).not.toMatch(/^(Put|Create|Delete|Update|Start|Stop|Terminate|Modify|Attach|Detach|Reboot|Invoke|Run)/);
    }
  });

  it("never grants data-plane reads and explicitly denies them", () => {
    const granted = new Set(READ_PERMISSIONS.map((p) => p.action));
    for (const denied of DATA_PLANE_DENY) expect(granted.has(denied)).toBe(false);
    expect(DATA_PLANE_DENY).toEqual(expect.arrayContaining(["s3:GetObject", "secretsmanager:GetSecretValue", "lambda:GetFunction"]));
  });

  it("keeps action permissions out of the read role", () => {
    const granted = new Set(READ_PERMISSIONS.map((p) => p.action));
    for (const a of ACTION_PERMISSIONS) expect(granted.has(a.action)).toBe(false);
    const cond = JSON.stringify(actionPolicy());
    expect(cond).toContain("aws:ResourceTag/stratus:actions-allowed");
  });

  it("every permission is documented and unique", () => {
    const seen = new Set<string>();
    for (const p of READ_PERMISSIONS) {
      expect(p.reason.length).toBeGreaterThan(5);
      expect(seen.has(p.action)).toBe(false);
      seen.add(p.action);
    }
  });

  it("CloudFormation template is valid JSON with no AdministratorAccess", () => {
    const tpl = readOnlyRoleTemplate(PRINCIPAL, EXT);
    const parsed = JSON.parse(tpl) as Record<string, unknown>;
    expect(parsed.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(tpl).not.toMatch(/AdministratorAccess|ReadOnlyAccess|"\*:\*"|"Action": "\*"/);
    expect(tpl).toContain(EXT);
  });

  it("escapes hostile input rather than injecting template structure", () => {
    const tpl = readOnlyRoleTemplate(PRINCIPAL, 'x"}, "Evil": {"a":"b');
    expect(() => JSON.parse(tpl)).not.toThrow();
    expect((JSON.parse(tpl) as Record<string, unknown>).Evil).toBeUndefined();
  });
});
