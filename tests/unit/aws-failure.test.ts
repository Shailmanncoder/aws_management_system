import { describe, expect, it } from "vitest";
import { describeAwsFailure, failureSummary } from "@/server/aws/aws-failure";

const awsErr = (name: string, message: string, status = 400) => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });

describe("describeAwsFailure", () => {
  it("distinguishes 'service not enabled' from a missing permission (both are AccessDeniedException)", () => {
    const notEnabled = describeAwsFailure(awsErr("AccessDeniedException", "User not enabled for cost explorer access"), "ce:GetCostAndUsage");
    expect(notEnabled.reason).toBe("service_not_enabled");
    expect(notEnabled.message).toMatch(/Cost Explorer is not enabled/);
    expect(notEnabled.remediation).toMatch(/root user/i);

    const denied = describeAwsFailure(awsErr("AccessDeniedException", "User: arn:aws:sts::1:assumed-role/X is not authorized to perform: ce:GetCostAndUsage because no identity-based policy allows it", 403), "ce:GetCostAndUsage");
    expect(denied.reason).toBe("permission_denied");
    expect(denied.message).toBe("Missing required AWS permission: ce:GetCostAndUsage");
  });

  it("detects service control policies and explicit denies", () => {
    expect(describeAwsFailure(awsErr("AccessDeniedException", "with an explicit deny in a service control policy", 403), "ec2:DescribeInstances").reason).toBe("scp_denied");
    expect(describeAwsFailure(awsErr("AccessDeniedException", "with an explicit deny in an identity-based policy", 403), "s3:ListAllMyBuckets").reason).toBe("explicit_deny");
  });

  it("classifies throttling, credentials and transient failures", () => {
    expect(describeAwsFailure(awsErr("ThrottlingException", "Rate exceeded"), "ce:GetCostAndUsage").reason).toBe("throttled");
    expect(describeAwsFailure(awsErr("ExpiredToken", "token expired"), "sts:AssumeRole").reason).toBe("credentials");
    expect(describeAwsFailure(awsErr("InternalFailure", "oops", 500), "ec2:DescribeInstances").reason).toBe("unavailable");
  });

  it("never echoes the raw AWS message (which can contain internal ARNs)", () => {
    const raw = "User: arn:aws:sts::111111111111:assumed-role/StratusPlatformRole/session is not authorized";
    const f = describeAwsFailure(awsErr("AccessDeniedException", raw, 403), "ce:GetCostAndUsage");
    const text = `${f.message} ${f.remediation} ${failureSummary(f)}`;
    expect(text).not.toContain("111111111111");
    expect(text).not.toContain("StratusPlatformRole");
    expect(failureSummary(f)).toContain("ce:GetCostAndUsage");
    expect(failureSummary(f)).toContain("AccessDeniedException");
  });
});
