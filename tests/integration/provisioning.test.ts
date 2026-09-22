import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetBucketEncryptionCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  GetBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import { POST as planRoute } from "@/app/api/v1/orgs/[orgId]/provisioning/plans/route";
import { POST as applyRoute } from "@/app/api/v1/orgs/[orgId]/provisioning/plans/[planId]/apply/route";
import { POST as setupRoute } from "@/app/api/v1/orgs/[orgId]/provisioning/accounts/[accountId]/setup/route";
import {
  makePlan,
  applyPlan,
  reconcilePlan,
  setupProvisioning,
} from "@/server/aws/provisioning/service";
import { authorizeOrg, type OrgAccess } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { resetEnvCacheForTests } from "@/server/env";
import { configurationSchema } from "@/lib/provisioning";
import { call, createUser, type TestUser } from "../helpers/app";
import { newOrg, addMember, connectFixtureAccount } from "../helpers/orgs";
const sts = mockClient(STSClient),
  s3 = mockClient(S3Client);
let owner: TestUser,
  viewer: TestUser,
  other: TestUser,
  access: OrgAccess,
  orgId: string,
  otherOrg: string,
  accountId: string,
  connectionId: string;
beforeAll(async () => {
  // Restore STS for fixture onboarding first; install the mock afterward.
  sts.restore();
  s3.restore();
  owner = await createUser("provision-owner");
  orgId = (await newOrg(owner, "Provisioning")).id;
  viewer = await addMember(owner, orgId, "VIEWER");
  other = await createUser("other-provision");
  otherOrg = (await newOrg(other, "Other provisioning")).id;
  accountId = (await connectFixtureAccount(owner, orgId)).accountId;
  access = await authorizeOrg(owner.id, orgId, "provisioning:create");
  await setupProvisioning(access, accountId);
  const conn = await getDb().awsConnection.findFirstOrThrow({
    where: { awsAccountRefId: accountId },
  });
  connectionId = conn.id;
  await getDb().awsConnection.update({
    where: { id: conn.id },
    data: { provisioningEnabled: true },
  });
  process.env.AWS_MODE = "live";
  resetEnvCacheForTests();
});
let stsMock: typeof sts, s3Mock: typeof s3;
beforeEach(async () => {
  stsMock = mockClient(STSClient);
  s3Mock = mockClient(S3Client);
  stsMock
    .on(AssumeRoleCommand)
    .resolves({
      Credentials: {
        AccessKeyId: "test-access",
        SecretAccessKey: "test-secret",
        SessionToken: "test-session",
        Expiration: new Date(Date.now() + 3600000),
      },
      AssumedRoleUser: {
        AssumedRoleId: "test-role-id",
        Arn: "arn:aws:sts::123456789012:assumed-role/StratusProvisionerRole/test",
      },
    });
  stsMock
    .on(GetCallerIdentityCommand)
    .resolves({
      Account: "123456789012",
      Arn: "arn:aws:sts::123456789012:assumed-role/StratusProvisionerRole/test",
    });
  s3Mock
    .on(HeadBucketCommand)
    .rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
  await getDb().rateLimitBucket.deleteMany({});
});
afterAll(() => {
  stsMock?.restore();
  s3Mock?.restore();
  process.env.AWS_MODE = "fixtures";
  resetEnvCacheForTests();
});
const config = () =>
  configurationSchema.parse({
    service: "s3",
    accountId,
    name: `stratus-${connectionId}-${randomUUID().slice(0, 8)}`,
    region: "us-east-1",
  });
async function planned() {
  return makePlan(access, {
    idempotencyKey: randomUUID(),
    configuration: config(),
  });
}
describe("provisioning authorization and tenancy", () => {
  it("requires authentication and server-side role authorization", async () => {
    const body = { idempotencyKey: randomUUID(), configuration: config() };
    expect((await call(planRoute, { params: { orgId }, body })).status).toBe(
      401,
    );
    expect(
      (await call(planRoute, { user: viewer, params: { orgId }, body })).status,
    ).toBe(403);
  });
  it("rejects cross-tenant paths and account substitution", async () => {
    const body = { idempotencyKey: randomUUID(), configuration: config() };
    expect(
      (await call(planRoute, { user: other, params: { orgId }, body })).status,
    ).toBe(404);
    expect(
      (
        await call(planRoute, {
          user: other,
          params: { orgId: otherOrg },
          body,
        })
      ).status,
    ).toBe(404);
  });
  it("rejects CSRF and arbitrary role ARN input", async () => {
    const body = { idempotencyKey: randomUUID(), configuration: config() };
    expect(
      (
        await call(planRoute, {
          user: owner,
          params: { orgId },
          body,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(planRoute, {
          user: owner,
          params: { orgId },
          body: { ...body, roleArn: "arn:bad" },
        })
      ).status,
    ).toBe(400);
  });
  it("restricts role setup and preserves the read-only role and ExternalId", async () => {
    expect(
      (
        await call(setupRoute, {
          user: viewer,
          params: { orgId, accountId },
          body: {},
        })
      ).status,
    ).toBe(403);
    const before = await getDb().awsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    await setupProvisioning(access, accountId);
    const after = await getDb().awsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(after.roleArn).toBe(before.roleArn);
    expect(after.externalIdEnc).toBe(before.externalIdEnc);
    expect(after.provisionerExternalIdEnc).not.toBe(after.externalIdEnc);
  });
  it("binds STS to the saved provisioning role and fresh ExternalId without exposing credentials", async () => {
    const p = await planned();
    const input = stsMock.commandCalls(AssumeRoleCommand)[0].args[0].input;
    expect(input.RoleArn).toBe(
      `arn:aws:iam::123456789012:role/StratusProvisionerRole-${connectionId}`,
    );
    expect(input.ExternalId).toMatch(/^stratus-/);
    expect(input.DurationSeconds).toBe(900);
    expect(JSON.stringify(p)).not.toMatch(
      /test-secret|test-session|ExternalId/,
    );
  });
});
describe("durable plans and apply", () => {
  it("deduplicates plans and rejects key reuse with changed input", async () => {
    const input = { idempotencyKey: randomUUID(), configuration: config() };
    const a = await makePlan(access, input),
      b = await makePlan(access, input);
    expect(a.id).toBe(b.id);
    await expect(
      makePlan(access, {
        ...input,
        configuration: {
          ...input.configuration,
          name: input.configuration.name + "x",
        },
      }),
    ).rejects.toThrow(/already used/);
  });
  it("rejects expired plans, configuration tampering and wrong confirmation before AWS mutation", async () => {
    const p = await planned();
    const review = p.review as { name: string };
    expect(
      (
        await call(applyRoute, {
          user: owner,
          params: { orgId, planId: p.id },
          body: {
            confirmation: review.name,
            configurationHash: "0".repeat(64),
          },
        })
      ).status,
    ).toBe(412);
    await getDb().provisioningPlan.update({
      where: { id: p.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      applyPlan(access, p.id, {
        confirmation: review.name,
        configurationHash: p.configurationHash,
        acknowledgeExposure: false,
      }),
    ).rejects.toThrow(/expired/);
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });
  it("rejects a plan requested by another user", async () => {
    const p = await planned();
    expect(
      (
        await call(applyRoute, {
          user: other,
          params: { orgId: otherOrg, planId: p.id },
          body: { confirmation: "x", configurationHash: p.configurationHash },
        })
      ).status,
    ).toBe(404);
  });
  it("creates once, verifies posture, persists inventory and appends an audit event", async () => {
    const p = await planned();
    const review = p.review as { name: string; tags: Record<string, string> };
    s3Mock.reset();
    s3Mock.resolves({});
    s3Mock
      .on(HeadBucketCommand)
      .rejectsOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } })
      .resolves({ BucketRegion: "us-east-1" });
    s3Mock
      .on(GetPublicAccessBlockCommand)
      .resolves({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      });
    s3Mock
      .on(GetBucketEncryptionCommand)
      .resolves({
        ServerSideEncryptionConfiguration: {
          Rules: [
            { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
          ],
        },
      });
    s3Mock
      .on(GetBucketOwnershipControlsCommand)
      .resolves({
        OwnershipControls: {
          Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
        },
      });
    s3Mock.on(GetBucketVersioningCommand).resolves({ Status: "Enabled" });
    s3Mock
      .on(GetBucketTaggingCommand)
      .resolves({
        TagSet: Object.entries(review.tags).map(([Key, Value]) => ({
          Key,
          Value,
        })),
      });
    const input = {
      confirmation: review.name,
      configurationHash: p.configurationHash,
      acknowledgeExposure: false,
    };
    const concurrent = await Promise.allSettled([
      applyPlan(access, p.id, input),
      applyPlan(access, p.id, input),
    ]);
    const done = concurrent.find(
      (r) => r.status === "fulfilled" && r.value.status === "SUCCEEDED",
    );
    expect(done, JSON.stringify(concurrent)).toBeDefined();
    expect((await applyPlan(access, p.id, input)).status).toBe("SUCCEEDED");
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
    const r = await getDb().awsResource.findFirst({
      where: { organizationId: orgId, resourceId: review.name },
    });
    expect(r).not.toBeNull();
    expect(
      await getDb().auditLog.count({
        where: {
          organizationId: orgId,
          action: "provisioning.s3.created",
          targetId: review.name,
        },
      }),
    ).toBe(1);
  });
  it("keeps ambiguous failures durable and prevents another account creation", async () => {
    const p = await planned();
    const next = await planned();
    s3Mock
      .on(CreateBucketCommand)
      .rejects(new Error("sensitive internal secret"));
    const review = p.review as { name: string };
    const done = await applyPlan(access, p.id, {
      confirmation: review.name,
      configurationHash: p.configurationHash,
      acknowledgeExposure: false,
    });
    expect(done.status).toBe("UNKNOWN");
    expect(done.resultMessage).not.toContain("sensitive internal secret");
    const nextReview = next.review as { name: string };
    await expect(
      applyPlan(access, next.id, {
        confirmation: nextReview.name,
        configurationHash: next.configurationHash,
        acknowledgeExposure: false,
      }),
    ).rejects.toThrow(/reconciliation/);
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
  });
});

it("administrator reconciliation releases an absent ambiguous deployment after the execution window", async () => {
  const p = await getDb().provisioningPlan.findFirstOrThrow({
    where: { organizationId: orgId, status: "UNKNOWN" },
  });
  await getDb().provisioningPlan.update({
    where: { id: p.id },
    data: {
      createdAt: new Date(Date.now() - 31 * 60_000),
      updatedAt: new Date(Date.now() - 31 * 60_000),
    },
  });
  const reconciled = await reconcilePlan(access, p.id);
  expect(reconciled.status).toBe("FAILED");
  expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  expect(
    await getDb().auditLog.count({
      where: {
        organizationId: orgId,
        action: "provisioning.reconciled_absent",
        targetId: p.id,
      },
    }),
  ).toBe(1);
});
