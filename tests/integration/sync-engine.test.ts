import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as triggerSync } from "@/app/api/v1/orgs/[orgId]/sync/route";
import { getDb } from "@/server/db";
import { claimNextJob, completeJob, enqueueJob, heartbeat } from "@/server/jobs/queue";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

const CREDENTIAL_MARKERS = ["ASIAFIXTUREFIXTURE00", "fixture/secret/access/key", "fixture-session-token-not-real", "fixture-secret-must-never-be-stored", "sk_test_fixture_never_store"];

async function clearQueue() {
  await getDb().syncJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
}

describe("job queue guarantees", () => {
  let orgId: string;
  let accountId: string;

  beforeAll(async () => {
    await clearQueue();
    const owner = await createUser("queue");
    orgId = (await newOrg(owner, "Queue Org")).id;
    accountId = (await connectFixtureAccount(owner, orgId)).accountId;
    await clearQueue();
  });

  it("deduplicates concurrent enqueues (one active job per account+type)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => enqueueJob({ organizationId: orgId, awsAccountRefId: accountId, type: "INVENTORY_SYNC", trigger: "MANUAL" })));
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
    expect(await getDb().syncJob.count({ where: { awsAccountRefId: accountId, type: "INVENTORY_SYNC", status: { in: ["QUEUED", "RUNNING"] } } })).toBe(1);
  });

  it("only one worker can claim a job (SKIP LOCKED)", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimNextJob(`w${i}`)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("fences out a worker whose lease was reclaimed", async () => {
    const job = (await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: accountId, status: "RUNNING" } }));
    await getDb().syncJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const reclaimed = await claimNextJob("new-owner");
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.lockedBy).toBe("new-owner");
    // The previous owner can neither heartbeat nor complete.
    expect(await heartbeat(job.id, job.lockedBy!)).toBe(false);
    expect(await completeJob(job.id, job.lockedBy!, { status: "SUCCEEDED" })).toBe(false);
    expect(await completeJob(job.id, "new-owner", { status: "SUCCEEDED" })).toBe(true);
  });
});

describe("inventory sync pipeline", () => {
  let owner: TestUser;
  let orgId: string;
  let prod: string;
  let staging: string;

  beforeAll(async () => {
    await clearQueue();
    owner = await createUser("sync-owner");
    orgId = (await newOrg(owner, "Sync Org")).id;
    prod = (await connectFixtureAccount(owner, orgId, "123456789012")).accountId;
    staging = (await connectFixtureAccount(owner, orgId, "210987654321")).accountId;
  });

  it("connection enqueues initial inventory + cost syncs", async () => {
    const jobs = await getDb().syncJob.findMany({ where: { organizationId: orgId } });
    expect(jobs.map((j) => j.type).sort()).toEqual(["COST_SYNC", "COST_SYNC", "INVENTORY_SYNC", "INVENTORY_SYNC"]);
  });

  it("syncs every region and resource type with full pagination", async () => {
    await drainJobs(orgId);
    const job = await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: prod, type: "INVENTORY_SYNC" } });
    expect(job.status).toBe("SUCCEEDED");
    const count = (type: string) => getDb().awsResource.count({ where: { organizationId: orgId, awsAccountRefId: prod, resourceType: type, deletedAt: null } });
    expect(await count("ec2:instance")).toBe(9); // fixture pages of 3 → 3 regions
    expect(await count("ec2:volume")).toBe(11);
    expect(await count("s3:bucket")).toBe(5); // ListBuckets paginates in pages of 3
    expect(await count("ec2:security-group")).toBe(7);
    expect(await count("ec2:subnet")).toBe(6);
    const regions = await getDb().awsResource.groupBy({ by: ["region"], where: { awsAccountRefId: prod, resourceType: "ec2:instance" } });
    expect(regions.map((r) => r.region).sort()).toEqual(["eu-west-1", "us-east-1", "us-west-2"]);
    const account = await getDb().awsAccount.findUniqueOrThrow({ where: { id: prod } });
    expect(account.syncStatus).toBe("SUCCEEDED");
    expect(account.lastSyncedAt).not.toBeNull();
  });

  it("stores bucket posture with per-signal observations and tags", async () => {
    const b = await getDb().awsResource.findFirstOrThrow({ where: { awsAccountRefId: prod, resourceId: "acme-public-website" }, include: { tags: true } });
    const a = b.attributes as Record<string, { ok: boolean; value?: unknown }>;
    expect(a.policyIsPublic).toEqual({ ok: true, value: true });
    expect(a.aclPublicGrants).toEqual({ ok: true, value: ["AllUsers:READ"] });
    expect(b.tags.map((t) => t.key)).toContain("env");
    const noPolicy = await getDb().awsResource.findFirstOrThrow({ where: { awsAccountRefId: prod, resourceId: "acme-eu-datalake" } });
    expect((noPolicy.attributes as Record<string, unknown>).policyIsPublic).toEqual({ ok: true, value: null });
    expect(noPolicy.region).toBe("eu-west-1");
  });

  it("one failing region → PARTIAL, other regions still synced", async () => {
    const job = await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: staging, type: "INVENTORY_SYNC" } });
    expect(job.status).toBe("PARTIAL");
    expect(job.errorSummary).toMatch(/partially completed/i);
    expect(job.errorSummary).toContain("us-west-2");
    expect(await getDb().awsResource.count({ where: { awsAccountRefId: staging, resourceType: "ec2:instance", region: "us-east-1", deletedAt: null } })).toBe(2);
  });

  it("marks vanished resources deleted, but never deletes data from a failing region", async () => {
    const db = getDb();
    const ghostOk = await db.awsResource.create({ data: { organizationId: orgId, awsAccountRefId: staging, resourceType: "ec2:instance", region: "us-east-1", resourceId: "i-ghost", attributes: {}, searchText: "i-ghost", lastSeenAt: new Date(Date.now() - 86400_000) } });
    const keptInFailingRegion = await db.awsResource.create({ data: { organizationId: orgId, awsAccountRefId: staging, resourceType: "ec2:instance", region: "us-west-2", resourceId: "i-west-still-there", attributes: {}, searchText: "x", lastSeenAt: new Date(Date.now() - 86400_000) } });
    const { deduplicated } = await enqueueJob({ organizationId: orgId, awsAccountRefId: staging, type: "INVENTORY_SYNC", trigger: "MANUAL" });
    const runs = await drainJobs(orgId);
    const stagingRun = runs.find((r) => r.job.awsAccountRefId === staging && r.job.type === "INVENTORY_SYNC");
    const detail = JSON.stringify({ deduplicated, ran: Boolean(stagingRun), result: stagingRun?.result });
    expect(stagingRun, `staging sync did not run: ${detail}`).toBeDefined();
    expect((await db.awsResource.findUniqueOrThrow({ where: { id: ghostOk.id } })).deletedAt, `ghost not marked deleted: ${detail}`).not.toBeNull();
    expect((await db.awsResource.findUniqueOrThrow({ where: { id: keptInFailingRegion.id } })).deletedAt).toBeNull();
  });

  it("sync is idempotent (re-running does not duplicate resources)", async () => {
    const before = await getDb().awsResource.count({ where: { awsAccountRefId: prod } });
    await enqueueJob({ organizationId: orgId, awsAccountRefId: prod, type: "INVENTORY_SYNC", trigger: "MANUAL" });
    await drainJobs(orgId);
    expect(await getDb().awsResource.count({ where: { awsAccountRefId: prod } })).toBe(before);
  });

  it("bumps the org inventory version (cache invalidation)", async () => {
    const org = await getDb().organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.inventoryVersion).toBeGreaterThan(0);
  });

  it("no credentials or secret-bearing fields are persisted after sync", async () => {
    const rows = await getDb().$queryRaw<{ j: string }[]>`SELECT row_to_json(t)::text AS j FROM aws_resources t`;
    const jobs = await getDb().$queryRaw<{ j: string }[]>`SELECT row_to_json(t)::text AS j FROM sync_jobs t`;
    const text = JSON.stringify([rows, jobs]);
    for (const m of CREDENTIAL_MARKERS) expect(text).not.toContain(m);
  });

  it("role deleted in AWS → job fails without retry and connection shows Role unavailable", async () => {
    const active = await getDb().syncJob.findMany({ where: { awsAccountRefId: staging, status: { in: ["QUEUED", "RUNNING"] } }, select: { type: true, status: true, attempts: true, errorSummary: true, runAfter: true } });
    expect(active, `unexpected active jobs: ${JSON.stringify(active)}`).toEqual([]);
    await getDb().awsConnection.updateMany({ where: { awsAccountRefId: staging }, data: { roleArn: "arn:aws:iam::210987654321:role/StratusDeletedRole" } });
    await enqueueJob({ organizationId: orgId, awsAccountRefId: staging, type: "INVENTORY_SYNC", trigger: "MANUAL" });
    const [run] = await drainJobs(orgId);
    expect(run!.result).toBe("failed");
    const conn = await getDb().awsConnection.findFirstOrThrow({ where: { awsAccountRefId: staging } });
    expect(conn.status).toBe("ROLE_UNAVAILABLE");
    const account = await getDb().awsAccount.findUniqueOrThrow({ where: { id: staging } });
    expect(account.syncStatus).toBe("FAILED");
    // Existing inventory is retained (not wiped) when the role disappears.
    expect(await getDb().awsResource.count({ where: { awsAccountRefId: staging, deletedAt: null } })).toBeGreaterThan(0);
  });
});

describe("manual sync API", () => {
  let owner: TestUser;
  let orgId: string;
  let accountId: string;

  beforeAll(async () => {
    await clearQueue();
    owner = await createUser("manual");
    orgId = (await newOrg(owner, "Manual Org")).id;
    accountId = (await connectFixtureAccount(owner, orgId)).accountId;
    await clearQueue();
  });

  it("viewer cannot trigger a sync; operator can", async () => {
    const viewer = await addMember(owner, orgId, "VIEWER");
    const operator = await addMember(owner, orgId, "OPERATOR");
    expect((await call(triggerSync, { user: viewer, params: { orgId }, body: { accountId } })).status).toBe(403);
    const res = await call(triggerSync, { user: operator, params: { orgId }, body: { accountId } });
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
  });

  it("duplicate requests collapse onto the active job", async () => {
    const res = await call(triggerSync, { user: owner, params: { orgId }, body: { accountId } });
    expect(res.body.jobs[0].deduplicated).toBe(true);
  });

  it("another tenant's account id is rejected", async () => {
    const other = await createUser("other");
    const otherOrg = (await newOrg(other, "Other")).id;
    expect((await call(triggerSync, { user: other, params: { orgId: otherOrg }, body: { accountId } })).status).toBe(404);
    expect((await call(triggerSync, { user: other, params: { orgId: otherOrg }, body: { accountId: randomUUID() } })).status).toBe(404);
  });

  it("is rate limited per account", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await call(triggerSync, { user: owner, params: { orgId }, body: { accountId } })).status);
    expect(statuses).toContain(429);
  });
});
