import { CloudTrailClient, DescribeTrailsCommand } from "@aws-sdk/client-cloudtrail";
import { GuardDutyClient, GetDetectorCommand, ListDetectorsCommand, ListFindingsCommand } from "@aws-sdk/client-guardduty";
import { IAMClient, GetAccountSummaryCommand, GetAccountPasswordPolicyCommand, ListUsersCommand, ListAccessKeysCommand } from "@aws-sdk/client-iam";
import { SecurityHubClient, GetFindingsCommand } from "@aws-sdk/client-securityhub";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSecuritySignals } from "@/server/aws/security-signals";
import { AwsSession } from "@/server/aws/session";
import { useLiveAwsMode } from "../helpers/live-mode";

const session = () => new AwsSession({ accountId: "123456789012", partition: "aws", kind: "assumed-role", sessionName: "test", credentials: { accessKeyId: "ASIATEST", secretAccessKey: "test-only" } });
describe("security signal coverage", () => {
  useLiveAwsMode();
  const iam = mockClient(IAMClient), ct = mockClient(CloudTrailClient), gd = mockClient(GuardDutyClient), sh = mockClient(SecurityHubClient);
  beforeEach(() => {
    for (const mock of [iam, ct, gd, sh]) mock.reset();
    iam.on(GetAccountSummaryCommand).resolves({ SummaryMap: { AccountMFAEnabled: 1, AccountAccessKeysPresent: 0 } });
    iam.on(GetAccountPasswordPolicyCommand).resolves({ PasswordPolicy: { MinimumPasswordLength: 14 } });
    iam.on(ListUsersCommand).resolves({ Users: [] });
    ct.on(DescribeTrailsCommand).resolves({ trailList: [] });
    gd.on(ListDetectorsCommand).resolves({ DetectorIds: [] });
    sh.on(GetFindingsCommand).resolves({ Findings: [] });
  });
  afterEach(() => { for (const mock of [iam, ct, gd, sh]) mock.reset(); });
  it("follows every Security Hub page", async () => {
    sh.on(GetFindingsCommand).resolvesOnce({ Findings: [{ Id: "one", Title: "First" } as never], NextToken: "page2" }).resolves({ Findings: [{ Id: "two", Title: "Second" } as never] });
    const s = session();
    try {
      const result = await collectSecuritySignals(s, ["us-east-1"]);
      expect(result.externalFindings.map((f) => f.id)).toEqual(["one", "two"]);
      expect(sh.commandCalls(GetFindingsCommand)[1]?.args[0].input.NextToken).toBe("page2");
    } finally { s.dispose(); }
  });
  it("marks partial access-key collection unavailable", async () => {
    iam.on(ListUsersCommand).resolves({ Users: [{ UserName: "denied" } as never] });
    iam.on(ListAccessKeysCommand).rejects({ name: "AccessDenied", message: "denied" });
    const s = session();
    try { expect((await collectSecuritySignals(s, [])).accessKeys.ok).toBe(false); } finally { s.dispose(); }
  });
  it("does not infer root MFA state from an empty summary", async () => {
    iam.on(GetAccountSummaryCommand).resolves({ SummaryMap: {} });
    const s = session();
    try { expect((await collectSecuritySignals(s, [])).accountSummary.ok).toBe(false); } finally { s.dispose(); }
  });
  it("marks denied GuardDuty finding reads unavailable", async () => {
    gd.on(ListDetectorsCommand).resolves({ DetectorIds: ["detector"] });
    gd.on(GetDetectorCommand).resolves({ Status: "ENABLED" });
    gd.on(ListFindingsCommand).rejects({ name: "AccessDenied", message: "denied" });
    const s = session();
    try { expect((await collectSecuritySignals(s, ["us-east-1"])).guardDuty["us-east-1"]?.ok).toBe(false); } finally { s.dispose(); }
  });
  it("distinguishes a disabled detector from enabled protection", async () => {
    gd.on(ListDetectorsCommand).resolves({ DetectorIds: ["detector"] });
    gd.on(GetDetectorCommand).resolves({ Status: "DISABLED" });
    const s = session();
    try { expect((await collectSecuritySignals(s, ["us-east-1"])).guardDuty["us-east-1"]).toEqual({ ok: true, value: { enabled: false } }); } finally { s.dispose(); }
  });
});
