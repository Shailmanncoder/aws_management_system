import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as patchAlert } from "@/app/api/v1/orgs/[orgId]/alerts/[id]/route";
import { POST as createRule } from "@/app/api/v1/orgs/[orgId]/alert-rules/route";
import { GET as search } from "@/app/api/v1/orgs/[orgId]/search/route";
import { GET as exportReport } from "@/app/api/v1/orgs/[orgId]/exports/[report]/route";
import { authorizeOrg } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { evaluateAlerts } from "@/server/services/alert-service";
import { getAuditLog } from "@/server/services/audit-query-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

describe("alerts, search and audit", () => {
  let owner: TestUser;
  let orgId: string;
  let accountId: string;

  beforeAll(async () => {
    owner = await createUser("alerts");
    orgId = (await newOrg(owner, "Alerts Org")).id;
    accountId = (await connectFixtureAccount(owner, orgId, "123456789012")).accountId;
    await drainJobs(orgId);
  });

  it("enables recommended rules on first connection; first sync is a quiet baseline", async () => {
    expect(await getDb().alertRule.count({ where: { organizationId: orgId } })).toBe(6);
    expect(await getDb().alert.count({ where: { organizationId: orgId, type: { in: ["NEW_SECURITY_FINDING", "PUBLIC_EXPOSURE"] } } })).toBe(0);
  });

  it("raises deduplicated alerts for new findings after the baseline", async () => {
    const since = new Date(Date.now() - 60 * 60_000);
    const first = await evaluateAlerts(orgId, accountId, since);
    const second = await evaluateAlerts(orgId, accountId, since);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0); // same dedupe keys
    const alerts = await getDb().alert.findMany({ where: { organizationId: orgId } });
    expect(alerts.some((a) => a.type === "PUBLIC_EXPOSURE")).toBe(true);
    expect(JSON.stringify(alerts)).not.toMatch(/ASIA|SecretAccessKey|fixture-secret/);
  });

  it("budget threshold rule fires from real cost records", async () => {
    const res = await call(createRule, { user: owner, params: { orgId }, body: { type: "COST_THRESHOLD", name: "Budget 100", enabled: true, config: { monthToDateAmount: 100, currency: "USD" } } });
    expect(res.status).toBe(200);
    await evaluateAlerts(orgId, accountId, new Date());
    expect(await getDb().alert.count({ where: { organizationId: orgId, type: "COST_THRESHOLD" } })).toBe(1);
  });

  it("acknowledge requires alerts:acknowledge and is tenant-scoped", async () => {
    const alert = await getDb().alert.findFirstOrThrow({ where: { organizationId: orgId, status: "OPEN" } });
    const viewer = await addMember(owner, orgId, "VIEWER");
    expect((await call(patchAlert, { method: "PATCH", user: viewer, params: { orgId, id: alert.id }, body: { status: "ACKNOWLEDGED" } })).status).toBe(403);
    const other = await createUser("alerts-other");
    const otherOrg = (await newOrg(other, "Other alerts")).id;
    expect((await call(patchAlert, { method: "PATCH", user: other, params: { orgId: otherOrg, id: alert.id }, body: { status: "RESOLVED" } })).status).toBe(404);
    expect((await call(patchAlert, { method: "PATCH", user: owner, params: { orgId, id: alert.id }, body: { status: "ACKNOWLEDGED" } })).status).toBe(200);
  });

  it("global search matches IDs, IPs and tags within the tenant only", async () => {
    const byIp = await call(search, { user: owner, params: { orgId }, path: "/api/x?q=198.51.100.10" });
    expect(byIp.body.results.map((r: { name: string }) => r.name)).toContain("web-1");
    const byTag = await call(search, { user: owner, params: { orgId }, path: "/api/x?q=cost-center%3Dcc-300" });
    expect(byTag.body.results.length).toBeGreaterThan(0);
    const other = await createUser("search-other");
    const otherOrg = (await newOrg(other, "Search other")).id;
    const none = await call(search, { user: other, params: { orgId: otherOrg }, path: "/api/x?q=web-1" });
    expect(none.body.results).toEqual([]);
    expect((await call(search, { user: other, params: { orgId }, path: "/api/x?q=web-1" })).status).toBe(404);
  });

  it("audit log is readable by audit roles only and exportable", async () => {
    const access = await authorizeOrg(owner.id, orgId, "audit:read");
    const log = await getAuditLog(access, {});
    expect(log.items.map((e) => e.action)).toEqual(expect.arrayContaining(["org.created", "aws.connected", "sync.completed"]));
    const operator = await addMember(owner, orgId, "OPERATOR");
    await expect(authorizeOrg(operator.id, orgId, "audit:read")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const csv = await call(exportReport, { user: owner, params: { orgId, report: "audit" }, path: "/api/x" });
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain("aws.connected");
  });

  it("scheduled re-sync keeps working with alerts enabled", async () => {
    await enqueueJob({ organizationId: orgId, awsAccountRefId: accountId, type: "INVENTORY_SYNC", trigger: "SCHEDULED" });
    const runs = await drainJobs(orgId);
    expect(runs.every((r) => typeof r.result !== "string")).toBe(true);
  });
});
