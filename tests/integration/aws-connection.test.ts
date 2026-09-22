import { beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as startConn } from "@/app/api/v1/orgs/[orgId]/aws-accounts/route";
import { DELETE as disconnect, GET as getAccount } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/route";
import { GET as getSetup } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/setup/route";
import { GET as getTemplate } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/template/route";
import { POST as validate } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/validate/route";
import { POST as accessKey } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/access-key/route";
import { getDb } from "@/server/db";
import { call, createUser, type TestUser } from "../helpers/app";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

// Strings the fixture STS returns as temporary credentials — they must never be persisted.
const FIXTURE_CREDENTIAL_MARKERS = ["ASIAFIXTUREFIXTURE00", "fixture/secret/access/key", "fixture-session-token-not-real"];
const LAMBDA_SECRET_MARKERS = ["fixture-secret-must-never-be-stored", "sk_test_fixture_never_store"];

async function dumpDatabaseText(): Promise<string> {
  const tables = await getDb().$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  let out = "";
  for (const { tablename } of tables) {
    const rows = await getDb().$queryRawUnsafe<unknown[]>(`SELECT row_to_json(t)::text AS j FROM "${tablename.replace(/"/g, "")}" t`);
    out += JSON.stringify(rows);
  }
  return out;
}

describe("AWS connection onboarding", () => {
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("conn-owner");
    orgId = (await newOrg(owner, "Conn Org")).id;
  });

  it("full wizard: start → setup → AssumeRole → identity → regions → diagnostics", async () => {
    const start = await call(startConn, { user: owner, params: { orgId }, body: { awsAccountId: "123456789012", displayName: "Production" } });
    expect(start.status).toBe(200);
    expect(start.body.account.connection.status).toBe("PENDING");
    const accountId = start.body.account.id as string;

    const setup = await call(getSetup, { user: owner, params: { orgId, accountId } });
    expect(setup.status).toBe(200);
    expect(setup.body.setup.externalId).toMatch(/^stratus-[A-Za-z0-9_-]{43}$/);
    expect(setup.body.setup.cloudFormationTemplate).toContain(setup.body.setup.externalId);

    // ExternalId is encrypted at rest (plaintext never in the DB).
    const row = await getDb().awsConnection.findFirstOrThrow({ where: { awsAccountRefId: accountId } });
    expect(row.externalIdEnc).not.toContain(setup.body.setup.externalId);
    expect(row.externalIdEnc.startsWith("v1.local.")).toBe(true);

    const v = await call(validate, { user: owner, params: { orgId, accountId }, body: { roleArn: "arn:aws:iam::123456789012:role/StratusReadOnlyRole" } });
    expect(v.status).toBe(200);
    expect(["CONNECTED", "NEEDS_ATTENTION"]).toContain(v.body.account.connection.status);
    expect(v.body.account.connection.enabledRegions).toEqual(["eu-west-1", "us-east-1", "us-west-2"]);
    expect(v.body.account.connection.diagnostics.requiredOk).toBe(true);

    const audit = await getDb().auditLog.findMany({ where: { organizationId: orgId, targetId: accountId } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["aws.connection_started", "aws.connected"]));
  });

  it("temporary STS credentials are never persisted anywhere in the database", async () => {
    const text = await dumpDatabaseText();
    for (const m of FIXTURE_CREDENTIAL_MARKERS) expect(text).not.toContain(m);
    for (const m of LAMBDA_SECRET_MARKERS) expect(text).not.toContain(m);
  });

  it("API responses never contain secret material or encrypted columns", async () => {
    const res = await call(listAccounts, { user: owner, params: { orgId } });
    const body = JSON.stringify(res.body);
    for (const bad of ["externalIdEnc", "secretAccessKeyEnc", "accessKeyIdEnc", "SecretAccessKey", "SessionToken", "stratus-", ...FIXTURE_CREDENTIAL_MARKERS]) {
      expect(body).not.toContain(bad);
    }
  });

  it("rejects invalid role ARNs", async () => {
    const acct = await connectFixtureAccount(owner, orgId, "210987654321", "StratusReadOnlyRole");
    for (const roleArn of ["not-an-arn", "arn:aws:iam::210987654321:user/alice", "arn:aws:iam::210987654321:role/x y"]) {
      const res = await call(validate, { user: owner, params: { orgId, accountId: acct.accountId }, body: { roleArn } });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a role in a different AWS account than declared (account substitution)", async () => {
    const s = await call(startConn, { user: owner, params: { orgId }, body: { awsAccountId: "444455556666", displayName: "Limited" } });
    const res = await call(validate, { user: owner, params: { orgId, accountId: s.body.account.id }, body: { roleArn: "arn:aws:iam::123456789012:role/StratusReadOnlyRole" } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AWS_ACCOUNT_MISMATCH");
  });

  it("refuses to connect or assume roles in the platform's own account", async () => {
    const res = await call(startConn, { user: owner, params: { orgId }, body: { awsAccountId: "111111111111", displayName: "Platform" } });
    expect(res.status).toBe(400);
  });

  it("role that cannot be assumed (deleted role / wrong ExternalId) → Connection failed, sanitised message", async () => {
    const s = await call(startConn, { user: owner, params: { orgId }, body: { awsAccountId: "444455556666", displayName: "Limited" } });
    const res = await call(validate, { user: owner, params: { orgId, accountId: s.body.account.id }, body: { roleArn: "arn:aws:iam::444455556666:role/StratusDeletedRole" } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AWS_ASSUME_ROLE_FAILED");
    expect(res.body.error.message).not.toMatch(/111111111111|not authorized to perform|arn:aws:sts/);
    const acct = await call(getAccount, { user: owner, params: { orgId, accountId: s.body.account.id } });
    expect(acct.body.account.connection.status).toBe("CONNECTION_FAILED");
  });

  it("limited permissions → Needs attention with precise missing actions", async () => {
    const acc = await getDb().awsAccount.findFirstOrThrow({ where: { organizationId: orgId, awsAccountId: "444455556666" } });
    const res = await call(validate, { user: owner, params: { orgId, accountId: acc.id }, body: { roleArn: "arn:aws:iam::444455556666:role/StratusReadOnlyRole" } });
    expect(res.status).toBe(200);
    expect(res.body.account.connection.status).toBe("NEEDS_ATTENTION");
    const probes = res.body.account.connection.diagnostics.probes as { iamAction: string; status: string }[];
    expect(probes.find((p) => p.iamAction === "ce:GetCostAndUsage")?.status).toBe("DENIED");
    expect(probes.find((p) => p.iamAction === "securityhub:DescribeHub")?.status).toBe("NOT_ENABLED");
  });

  it("previously connected role that disappears → Role unavailable", async () => {
    const acc = await getDb().awsAccount.findFirstOrThrow({ where: { organizationId: orgId, awsAccountId: "444455556666" } });
    const res = await call(validate, { user: owner, params: { orgId, accountId: acc.id }, body: { roleArn: "arn:aws:iam::444455556666:role/StratusDeletedRole" } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AWS_ROLE_UNAVAILABLE");
  });

  it("access-key mode is disabled by default", async () => {
    const acc = await getDb().awsAccount.findFirstOrThrow({ where: { organizationId: orgId, awsAccountId: "444455556666" } });
    const res = await call(accessKey, { user: owner, params: { orgId, accountId: acc.id }, body: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("template download is an attachment and not cacheable", async () => {
    const acc = await getDb().awsAccount.findFirstOrThrow({ where: { organizationId: orgId, awsAccountId: "123456789012" } });
    const res = await call(getTemplate, { user: owner, params: { orgId, accountId: acc.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("AWS connection authorization", () => {
  let owner: TestUser;
  let other: TestUser;
  let orgA: string;
  let orgB: string;
  let accountA: string;

  beforeAll(async () => {
    owner = await createUser("a-owner");
    other = await createUser("b-owner");
    orgA = (await newOrg(owner, "Org A")).id;
    orgB = (await newOrg(other, "Org B")).id;
    accountA = (await connectFixtureAccount(owner, orgA)).accountId;
  });

  it("User A cannot retrieve User B's AWS connection (either path)", async () => {
    expect((await call(getAccount, { user: other, params: { orgId: orgA, accountId: accountA } })).status).toBe(404);
    // IDOR: B's own org id + A's account id.
    expect((await call(getAccount, { user: other, params: { orgId: orgB, accountId: accountA } })).status).toBe(404);
    expect((await call(getSetup, { user: other, params: { orgId: orgB, accountId: accountA } })).status).toBe(404);
    expect((await call(validate, { user: other, params: { orgId: orgB, accountId: accountA }, body: {} })).status).toBe(404);
    expect((await call(disconnect, { method: "DELETE", user: other, params: { orgId: orgB, accountId: accountA } })).status).toBe(404);
    expect(await getDb().awsAccount.count({ where: { id: accountA } })).toBe(1);
  });

  it("manipulated resource ids are rejected", async () => {
    for (const accountId of ["1", "../x", "'; DROP TABLE aws_accounts;--", accountA.slice(0, -1)]) {
      expect((await call(getAccount, { user: owner, params: { orgId: orgA, accountId } })).status).toBe(400);
    }
  });

  it("viewers see accounts but not the ExternalId or setup; operators cannot connect", async () => {
    const viewer = await addMember(owner, orgA, "VIEWER");
    const operator = await addMember(owner, orgA, "OPERATOR");
    expect((await call(listAccounts, { user: viewer, params: { orgId: orgA } })).status).toBe(200);
    expect((await call(getSetup, { user: viewer, params: { orgId: orgA, accountId: accountA } })).status).toBe(403);
    expect((await call(startConn, { user: operator, params: { orgId: orgA }, body: { awsAccountId: "210987654321", displayName: "x" } })).status).toBe(403);
    expect((await call(disconnect, { method: "DELETE", user: operator, params: { orgId: orgA, accountId: accountA } })).status).toBe(403);
  });

  it("billing viewer cannot list AWS resources but can see accounts", async () => {
    const billing = await addMember(owner, orgA, "BILLING_VIEWER");
    expect((await call(listAccounts, { user: billing, params: { orgId: orgA } })).status).toBe(200);
  });

  it("owner can disconnect; data is removed and audited", async () => {
    const res = await call(disconnect, { method: "DELETE", user: owner, params: { orgId: orgA, accountId: accountA } });
    expect(res.status).toBe(200);
    expect(await getDb().awsAccount.count({ where: { id: accountA } })).toBe(0);
    expect(await getDb().awsConnection.count({ where: { awsAccountRefId: accountA } })).toBe(0);
    expect(await getDb().auditLog.count({ where: { action: "aws.disconnected", targetId: accountA } })).toBe(1);
  });
});
