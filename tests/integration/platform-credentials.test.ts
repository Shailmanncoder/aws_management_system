import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DELETE as clearRoute, GET as getRoute, PUT as putRoute } from "@/app/api/v1/orgs/[orgId]/platform-credentials/route";
import { awsMode, invalidatePlatformCredentials, loadPlatformIdentity } from "@/server/aws/platform-credentials";
import { getDb } from "@/server/db";
import { call, createUser, type TestUser } from "../helpers/app";
import { addMember, newOrg } from "../helpers/orgs";

const KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ACCOUNT = "123456789012";
const USER_ARN = `arn:aws:iam::${ACCOUNT}:user/stratus-platform`;

const sts = mockClient(STSClient);

describe("platform credentials configured from inside the app", () => {
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("platform");
    orgId = (await newOrg(owner, "Platform Org")).id;
  });

  beforeEach(() => {
    sts.reset();
    invalidatePlatformCredentials();
  });

  afterEach(async () => {
    await getDb().platformCredential.deleteMany({});
    invalidatePlatformCredentials();
  });

  const save = (user: TestUser, body: Record<string, unknown>) => call(putRoute, { user, params: { orgId }, body, method: "PUT" });

  it("verifies the key with AWS and stores the identity AWS reports, not what was typed", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT, UserId: "AIDA" });

    const res = await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.principalArn).toBe(USER_ARN);
    expect(res.body.awsAccountId).toBe(ACCOUNT);

    const stored = await getDb().platformCredential.findUnique({ where: { id: "singleton" } });
    expect(stored).not.toBeNull();
    // The secret must be encrypted at rest, never readable from the row.
    expect(stored!.secretAccessKeyEnc).not.toContain(SECRET);
    expect(stored!.accessKeyIdEnc).not.toContain(KEY);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });

  it("never returns the secret to the browser", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    const saved = await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });
    const fetched = await call(getRoute, { user: owner, params: { orgId } });

    for (const body of [saved.body, fetched.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(KEY);
    }
  });

  it("decrypts back to the original credentials for AWS calls", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "eu-west-1" });

    invalidatePlatformCredentials();
    const identity = await loadPlatformIdentity(true);
    expect(identity?.source).toBe("database");
    expect(identity?.credentials?.accessKeyId).toBe(KEY);
    expect(identity?.credentials?.secretAccessKey).toBe(SECRET);
    expect(identity?.region).toBe("eu-west-1");
  });

  it("refuses root credentials outright", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: `arn:aws:iam::${ACCOUNT}:root`, Account: ACCOUNT });
    const res = await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });

    expect(res.status).toBe(400);
    expect(String(res.body.error?.message ?? res.body.message)).toMatch(/root user/i);
    expect(await getDb().platformCredential.count()).toBe(0);
  });

  it("reports rejection without echoing the key back", async () => {
    sts.on(GetCallerIdentityCommand).rejects(Object.assign(new Error("The security token included in the request is invalid"), { name: "InvalidClientTokenId" }));
    const res = await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("rejects a malformed key or an unknown region before calling AWS", async () => {
    expect((await save(owner, { accessKeyId: "not-a-key", secretAccessKey: SECRET, region: "us-east-1" })).status).toBe(400);
    expect((await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "evil.example.com" })).status).toBe(400);
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(0);
  });

  it("switches the effective AWS mode to live once real credentials exist", async () => {
    // The test suite runs with AWS_MODE=fixtures.
    invalidatePlatformCredentials();
    await loadPlatformIdentity(true);
    expect(awsMode()).toBe("fixtures");

    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });
    await loadPlatformIdentity(true);
    expect(awsMode()).toBe("live");
  });

  it("records the change in the audit trail without the secret", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });

    const entry = await getDb().auditLog.findFirst({ where: { organizationId: orgId, action: "platform.credentials_set" }, orderBy: { createdAt: "desc" } });
    expect(entry).not.toBeNull();
    const text = JSON.stringify(entry);
    expect(text).toContain(USER_ARN);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
  });

  it("can be removed again", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });

    const res = await call(clearRoute, { user: owner, params: { orgId }, method: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(await getDb().platformCredential.count()).toBe(0);
  });

  it("refuses a non-owner, because these credentials affect the whole deployment", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
    const admin = await addMember(owner, orgId, "ADMIN");
    const res = await save(admin, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });
    expect(res.status).toBe(403);
    expect(await getDb().platformCredential.count()).toBe(0);
  });

  it("is refused entirely when the operator has not opted in", async () => {
    // The default is off: on a multi-tenant deployment one Owner must not be able to change
    // credentials shared by every workspace.
    const { resetEnvCacheForTests } = await import("@/server/env");
    const previous = process.env.ALLOW_IN_APP_PLATFORM_SETUP;
    process.env.ALLOW_IN_APP_PLATFORM_SETUP = "false";
    resetEnvCacheForTests();
    try {
      sts.on(GetCallerIdentityCommand).resolves({ Arn: USER_ARN, Account: ACCOUNT });
      const res = await save(owner, { accessKeyId: KEY, secretAccessKey: SECRET, region: "us-east-1" });
      expect(res.status).toBe(403);
      expect(await getDb().platformCredential.count()).toBe(0);
    } finally {
      process.env.ALLOW_IN_APP_PLATFORM_SETUP = previous;
      resetEnvCacheForTests();
    }
  });
});
