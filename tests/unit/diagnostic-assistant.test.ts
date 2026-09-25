import { describe, expect, it } from "vitest";
import { buildDiagnosticReply, type DiagnosticIssue } from "@/lib/diagnostic-assistant";
import { diagnosticQuestionInput } from "@/server/services/diagnostic-assistant-service";
import { redactString } from "@/server/logging/redact";

describe("private diagnostic assistant", () => {
  it("redacts AWS credentials before memory or diagnosis", () => {
    expect(redactString("key AKIA1234567890ABCDEF failed")).toBe("key [REDACTED] failed");
    expect(redactString("Authorization: Bearer abcdefghijklmnop")).toContain("Bearer [REDACTED]");
  });

  it("selects the relevant structured issue", () => {
    const issues: DiagnosticIssue[] = [
      { code: "SYNC_FAILED", severity: "critical", title: "Production synchronization failed", detail: "AWS denied ec2:DescribeRegions.", nextStep: "Update the role." },
      { code: "COST", severity: "warning", title: "Cost data unavailable", detail: "Cost Explorer is disabled.", nextStep: "Enable Cost Explorer." },
    ];
    const reply = buildDiagnosticReply("Why did synchronization fail?", issues);
    expect(reply).toContain("Production synchronization failed");
    expect(reply).not.toContain("Cost data unavailable");
  });

  it("accepts only bounded supported screenshot data", () => {
    expect(diagnosticQuestionInput.safeParse({ question: "What is shown?", image: { mimeType: "image/png", data: "YWJj" } }).success).toBe(true);
    expect(diagnosticQuestionInput.safeParse({ question: "What is shown?", image: { mimeType: "image/svg+xml", data: "YWJj" } }).success).toBe(false);
    expect(diagnosticQuestionInput.safeParse({ question: "What is shown?", image: { mimeType: "image/png", data: "not base64!" } }).success).toBe(false);
  });
});
