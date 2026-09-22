import { beforeAll, describe, expect, it } from "vitest";
import { POST as triggerSync } from "@/app/api/v1/orgs/[orgId]/sync/route";
import { GET as exportReport } from "@/app/api/v1/orgs/[orgId]/exports/[report]/route";
import { authorizeOrg } from "@/server/authz/guard";
import { clearCacheForTests } from "@/server/cache/tenant-cache";
import { getDb } from "@/server/db";
import { getCostOverview, parseCostParams } from "@/server/services/cost-service";
import { getInventorySummary } from "@/server/services/dashboard-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

describe("cost sync and analytics", () => {
  let owner: TestUser;
  let orgId: string;
  let prod: string;
  let limited: string;

  beforeAll(async () => {
    await getDb().syncJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
    clearCacheForTests();
    owner = await createUser("cost");
    orgId = (await newOrg(owner, "Cost Org")).id;
    prod = (await connectFixtureAccount(owner, orgId, "123456789012")).accountId;
    limited = (await connectFixtureAccount(owner, orgId, "444455556666")).accountId;
    await drainJobs(orgId);
  });

  it("backfills ~13 months of daily and monthly data with Cost Explorer pagination", async () => {
    const job = await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: prod, type: "COST_SYNC" } });
    expect(job.status).toBe("SUCCEEDED");
    const days = await getDb().costRecord.groupBy({ by: ["periodStart"], where: { awsAccountRefId: prod, granularity: "DAILY", dimension: "TOTAL" } });
    expect(days.length).toBeGreaterThan(390); // > 90 per page → several pages followed
    const months = await getDb().costRecord.count({ where: { awsAccountRefId: prod, granularity: "MONTHLY", dimension: "TOTAL" } });
    expect(months).toBeGreaterThanOrEqual(13);
    expect((job.metrics as { costExplorerRequests: number }).costExplorerRequests).toBeGreaterThan(7);
  });

  it("re-sync is idempotent (window replaced, no duplicates)", async () => {
    const before = await getDb().costRecord.count({ where: { awsAccountRefId: prod } });
    await call(triggerSync, { user: owner, params: { orgId }, body: { accountId: prod, type: "COST_SYNC" } });
    await drainJobs(orgId);
    expect(await getDb().costRecord.count({ where: { awsAccountRefId: prod } })).toBe(before);
  });

  it("re-backfills when stored history is all zeros (Cost Explorer enabled moments earlier)", async () => {
    // Simulate the real-world case: the first sync succeeded while AWS was still preparing data,
    // so every stored amount is 0. The next sync must do a full backfill, not an incremental window.
    await getDb().costRecord.updateMany({ where: { awsAccountRefId: prod }, data: { amount: 0 } });
    await call(triggerSync, { user: owner, params: { orgId }, body: { accountId: prod, type: "COST_SYNC" } });
    await drainJobs(orgId);
    const job = await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: prod, type: "COST_SYNC" }, orderBy: { createdAt: "desc" } });
    expect((job.metrics as { backfill: boolean }).backfill).toBe(true);
    const nonZero = await getDb().costRecord.count({ where: { awsAccountRefId: prod, amount: { not: 0 } } });
    expect(nonZero).toBeGreaterThan(300);
  });

  it("reports 'still preparing' rather than a bare zero when a successful sync returns no charges", async () => {
    const { clearCacheForTests } = await import("@/server/cache/tenant-cache");
    await getDb().costRecord.updateMany({ where: { awsAccountRefId: prod }, data: { amount: 0 } });
    clearCacheForTests();
    const access = await authorizeOrg(owner.id, orgId, "cost:read");
    const o = await getCostOverview(access, parseCostParams({ range: "30d" }));
    const cov = o.coverage.find((c) => c.accountRefId === prod)!;
    expect(cov.status).toBe("pending");
    expect(cov.message).toMatch(/up to 24 hours/);
    // Restore real amounts for the remaining tests.
    await call(triggerSync, { user: owner, params: { orgId }, body: { accountId: prod, type: "COST_SYNC" } });
    await drainJobs(orgId);
    clearCacheForTests();
  });

  it("denied billing is reported as unavailable — never fabricated", async () => {
    const job = await getDb().syncJob.findFirstOrThrow({ where: { awsAccountRefId: limited, type: "COST_SYNC" }, orderBy: { createdAt: "desc" } });
    expect(job.status).toBe("FAILED");
    expect(job.errorSummary).toMatch(/Billing data is not available/);
    expect(await getDb().costRecord.count({ where: { awsAccountRefId: limited } })).toBe(0);
    const access = await authorizeOrg(owner.id, orgId, "cost:read");
    const overview = await getCostOverview(access, parseCostParams({ range: "30d" }));
    const cov = overview.coverage.find((c) => c.accountRefId === limited)!;
    expect(cov.status).toBe("unavailable");
  });

  it("computes summary, series and breakdowns from stored AWS data", async () => {
    const access = await authorizeOrg(owner.id, orgId, "cost:read");
    const o = await getCostOverview(access, parseCostParams({ range: "30d" }));
    expect(o.summary.hasData).toBe(true);
    expect(o.daily).toHaveLength(30);
    expect(o.daily.filter((d) => d.amount !== null).length).toBeGreaterThanOrEqual(29);
    const serviceSum = o.byService.reduce((a, b) => a + b.amount, 0);
    const dailySum = o.daily.reduce((a, b) => a + (b.amount ?? 0), 0);
    expect(serviceSum).toBeCloseTo(dailySum, 0);
    expect(o.byService[0]!.key).toBe("Amazon Elastic Compute Cloud - Compute");
    expect(o.monthly.length).toBeGreaterThanOrEqual(12);
    expect(o.monthly.at(-1)!.estimated).toBe(true);
    expect(o.byAccount.map((a) => a.key)).toContain("Acct 123456789012");
  });

  it("region filter switches the series to region-level data", async () => {
    const access = await authorizeOrg(owner.id, orgId, "cost:read");
    const all = await getCostOverview(access, parseCostParams({ range: "7d" }));
    const eu = await getCostOverview(access, parseCostParams({ range: "7d", region: "eu-west-1" }));
    const sum = (x: typeof all) => x.daily.reduce((a, b) => a + (b.amount ?? 0), 0);
    expect(sum(eu)).toBeLessThan(sum(all) * 0.3);
  });

  it("invalid custom ranges fall back safely", () => {
    expect(parseCostParams({ range: "custom", from: "2026-09-10", to: "2026-01-01" }).range).toBe("30d");
    expect(parseCostParams({ range: "custom", from: "2020-01-01", to: "2026-01-01" }).range).toBe("30d");
    expect(parseCostParams({ range: "'; DROP TABLE" }).range).toBe("30d");
  });

  it("cost data is tenant-isolated and role-gated", async () => {
    const other = await createUser("cost-other");
    const otherOrg = (await newOrg(other, "Other cost")).id;
    const access = await authorizeOrg(other.id, otherOrg, "cost:read");
    const o = await getCostOverview(access, parseCostParams({ range: "30d", account: prod }));
    expect(o.daily.every((d) => d.amount === null)).toBe(true);
    const secViewer = await addMember(owner, orgId, "SECURITY_VIEWER");
    await expect(authorizeOrg(secViewer.id, orgId, "cost:read")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await call(exportReport, { user: secViewer, params: { orgId, report: "cost" }, path: "/api/x" })).status).toBe(403);
  });

  it("billing viewer can export cost CSV", async () => {
    const billing = await addMember(owner, orgId, "BILLING_VIEWER");
    const res = await call(exportReport, { user: billing, params: { orgId, report: "cost" }, path: "/api/x?range=7d" });
    expect(res.status).toBe(200);
    expect(String(res.body).split("\r\n")[0]).toBe("date,account_id,account_name,dimension,key,amount,unit,estimated");
  });

  it("dashboard inventory summary reflects synced data", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const inv = await getInventorySummary(access, {});
    expect(inv.accounts).toBe(2);
    expect(inv.ec2).toBe(10);
    expect(inv.regions).toBe(3);
  });
});
