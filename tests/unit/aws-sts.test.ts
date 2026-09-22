import { inspect } from "node:util";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { AssumeRoleError, assumeRoleSession, buildSessionName, getCallerIdentity } from "@/server/aws/sts";
import { useLiveAwsMode } from "../helpers/live-mode";

const sts = mockClient(STSClient);
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const TOKEN = "IQoJb3JpZ2luX2VjEXAMPLETOKEN" + "x".repeat(100);

const params = {
  roleArn: "arn:aws:iam::123456789012:role/StratusReadOnlyRole",
  externalId: "stratus-" + "a".repeat(43),
  sessionName: "stratus-test-1",
  partition: "aws",
  expectedAccountId: "123456789012",
};

function creds(expiresInMs = 3600_000) {
  return {
    Credentials: { AccessKeyId: "ASIAEXAMPLEEXAMPLE12", SecretAccessKey: SECRET, SessionToken: TOKEN, Expiration: new Date(Date.now() + expiresInMs) },
    AssumedRoleUser: { Arn: "arn:aws:sts::123456789012:assumed-role/StratusReadOnlyRole/stratus-test-1", AssumedRoleId: "AROA:x" },
  };
}

describe("STS AssumeRole", () => {
  useLiveAwsMode();
  beforeEach(() => sts.reset());

  it("passes the ExternalId and session name, returns a session", async () => {
    sts.on(AssumeRoleCommand).resolves(creds());
    const session = await assumeRoleSession(params);
    const call = sts.commandCalls(AssumeRoleCommand)[0]!;
    expect(call.args[0].input).toMatchObject({ RoleArn: params.roleArn, ExternalId: params.externalId, RoleSessionName: "stratus-test-1" });
    expect(session.accountId).toBe("123456789012");
    const c = await session.credentialProvider();
    expect(c.secretAccessKey).toBe(SECRET);
  });

  it("treats an empty credentials response as unavailable", async () => {
    sts.on(AssumeRoleCommand).resolves({});
    await expect(assumeRoleSession(params)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("never exposes credentials via JSON, inspect or enumeration", async () => {
    sts.on(AssumeRoleCommand).resolves(creds());
    const session = await assumeRoleSession(params);
    const views = [JSON.stringify(session), inspect(session, { depth: 10, showHidden: true }), JSON.stringify(Object.entries(session)), String(Object.keys(session))];
    for (const v of views) {
      expect(v).not.toContain(SECRET);
      expect(v).not.toContain(TOKEN);
    }
    session.dispose();
    await expect(session.credentialProvider()).rejects.toThrow(/disposed/);
  });

  it("maps AccessDenied (wrong ExternalId / missing role / bad trust) to a generic denial", async () => {
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error("User: arn:aws:sts::111111111111:assumed-role/Platform is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::123456789012:role/StratusReadOnlyRole"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    const err = await assumeRoleSession(params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssumeRoleError);
    expect((err as AssumeRoleError).reason).toBe("denied");
  });

  it("rejects when AWS returns an assumed role in a different account (substitution)", async () => {
    sts.on(AssumeRoleCommand).resolves({ ...creds(), AssumedRoleUser: { Arn: "arn:aws:sts::999999999999:assumed-role/X/y", AssumedRoleId: "A" } });
    await expect(assumeRoleSession(params)).rejects.toMatchObject({ reason: "denied" });
  });

  it("classifies throttling and platform credential problems", async () => {
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "Throttling" }));
    await expect(assumeRoleSession(params)).rejects.toMatchObject({ reason: "throttled" });
    sts.reset();
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error("bad"), { name: "InvalidClientTokenId" }));
    await expect(assumeRoleSession(params)).rejects.toMatchObject({ reason: "platform_misconfigured" });
  });

  it("refreshes credentials shortly before expiry", async () => {
    sts.on(AssumeRoleCommand).resolvesOnce(creds(60_000)).resolvesOnce(creds());
    const session = await assumeRoleSession(params);
    await session.credentialProvider();
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(2);
  });

  it("identity check detects root principals", async () => {
    sts.on(AssumeRoleCommand).resolves(creds());
    sts.on(GetCallerIdentityCommand).resolves({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:root" });
    const id = await getCallerIdentity(await assumeRoleSession(params));
    expect(id.isRoot).toBe(true);
  });

  it("builds CloudTrail-safe session names", () => {
    expect(buildSessionName("sync job", "abc/def")).toBe("stratus-sync-job-abc-def");
    expect(buildSessionName("x".repeat(100), "y").length).toBeLessThanOrEqual(64);
  });
});
