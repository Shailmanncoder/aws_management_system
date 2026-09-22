import { beforeAll, describe, expect, it } from "vitest";
import { GET as exportReport } from "@/app/api/v1/orgs/[orgId]/exports/[report]/route";
import { GET as getMetrics } from "@/app/api/v1/orgs/[orgId]/resources/[id]/metrics/route";
import { authorizeOrg } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { getResourceDetail, listInventory, parseListParams } from "@/server/services/inventory-service";
import { getTopology } from "@/server/services/network-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

describe("inventory queries, metrics and exports", () => {
  let owner: TestUser;
  let orgId: string;
  let otherOrgId: string;
  let other: TestUser;

  beforeAll(async () => {
    await getDb().syncJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
    owner = await createUser("inv");
    orgId = (await newOrg(owner, "Inventory Org")).id;
    await connectFixtureAccount(owner, orgId, "123456789012");
    await drainJobs(orgId);
    other = await createUser("inv-other");
    otherOrgId = (await newOrg(other, "Other Inventory Org")).id;
    await connectFixtureAccount(other, otherOrgId, "210987654321");
    await drainJobs(otherOrgId);
  });

  it("filters by state, instance type, VPC, region and tag", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const types = ["ec2:instance" as const];
    expect((await listInventory(access, types, parseListParams({ state: "stopped" }))).total).toBe(2);
    expect((await listInventory(access, types, parseListParams({ instanceType: "t3.medium" }))).total).toBe(2);
    expect((await listInventory(access, types, parseListParams({ vpc: "vpc-0prod0001" }))).total).toBe(6);
    expect((await listInventory(access, types, parseListParams({ region: "eu-west-1" }))).total).toBe(1);
    expect((await listInventory(access, types, parseListParams({ tag: "team=data" }))).total).toBe(3);
    expect((await listInventory(access, types, parseListParams({ tag: "cost-center" }))).total).toBe(5);
  });

  it("search matches name, id, IP and tags", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const all = ["ec2:instance" as const, "s3:bucket" as const];
    expect((await listInventory(access, all, parseListParams({ q: "bastion" }))).items[0]?.name).toBe("bastion");
    expect((await listInventory(access, all, parseListParams({ q: "198.51.100.12" }))).total).toBeGreaterThanOrEqual(1);
    expect((await listInventory(access, all, parseListParams({ q: "i-0a1b2c3d4e5f60007" }))).items[0]?.name).toBe("analytics-1");
    expect((await listInventory(access, all, parseListParams({ q: "acme-public" }))).total).toBe(1);
  });

  it("search never crosses tenants", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const res = await listInventory(access, ["ec2:instance"], parseListParams({ q: "staging-app" }));
    expect(res.total).toBe(0);
  });

  it("hostile filter values are dropped, not executed", async () => {
    const p = parseListParams({ q: "%' OR 1=1 --", region: "us-east-1' --", sort: "password", page: "-5", pageSize: "100000", vpc: "../../x", state: "<script>" });
    expect(p.region).toBeUndefined();
    expect(p.sort).toBeUndefined();
    expect(p.page).toBeUndefined();
    expect(p.pageSize).toBeUndefined();
    expect(p.vpc).toBeUndefined();
    expect(p.state).toBeUndefined();
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    expect((await listInventory(access, ["ec2:instance"], p)).total).toBe(0);
  });

  it("resource detail by id is tenant-scoped (IDOR)", async () => {
    const foreign = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: otherOrgId } });
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    await expect(getResourceDetail(access, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never stores Lambda env vars or RDS master usernames (allow-list normalisation)", async () => {
    const text = JSON.stringify(await getDb().awsResource.findMany({ where: { organizationId: orgId }, select: { attributes: true, searchText: true } }));
    expect(text).not.toMatch(/fixture-secret-must-never-be-stored|sk_test_fixture|fixture_admin|DB_PASSWORD/);
  });

  it("collects every supported service with correct normalised attributes", async () => {
    const count = (t: string) => getDb().awsResource.count({ where: { organizationId: orgId, resourceType: t, deletedAt: null } });
    expect(await count("rds:db-instance")).toBe(3);
    expect(await count("rds:db-cluster")).toBe(1);
    expect(await count("dynamodb:table")).toBe(2);
    expect(await count("lambda:function")).toBe(5); // ListFunctions pages of 2 → pagination exercised
    expect(await count("ecs:cluster")).toBe(1);
    expect(await count("ecs:service")).toBe(2);
    expect(await count("eks:cluster")).toBe(1);
    expect(await count("ecr:repository")).toBe(3);
    expect(await count("elb:load-balancer")).toBe(2);
    expect(await count("cloudfront:distribution")).toBe(1);
    expect(await count("route53:hosted-zone")).toBe(2);
    expect(await count("sqs:queue")).toBe(2);
    const fn = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "orders-processor" } });
    expect((fn.attributes as { environmentVariableCount: number }).environmentVariableCount).toBe(2);
    const repo = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "notifications" } });
    expect(repo.attributes).toMatchObject({ imageCount: 17, scanOnPush: false, latestScan: { critical: 1, high: 4 } });
    const db = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "legacy-mysql" } });
    expect(db.attributes).toMatchObject({ publiclyAccessible: true, encrypted: false, backupRetentionDays: 0 });
  });

  it("topology links instances to subnets and derives public subnets from routes", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const topo = await getTopology(access, { vpcId: "vpc-0prod0001" });
    const vpc = topo.regions[0]!.vpcs[0]!;
    const pub = vpc.subnets.filter((s) => s.isPublic).map((s) => s.resourceId).sort();
    expect(pub).toEqual(["subnet-0pub0001a", "subnet-0pub0001b"]);
    const bastionSubnet = vpc.subnets.find((s) => s.instances.some((i) => i.name === "bastion"));
    expect(bastionSubnet?.resourceId).toBe("subnet-0pub0001a");
  });

  it("CloudWatch metrics: series for running instances, graceful empty for stopped", async () => {
    const running = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "i-0a1b2c3d4e5f60001" } });
    const stopped = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "i-0a1b2c3d4e5f60006" } });
    const r1 = await call(getMetrics, { user: owner, params: { orgId, id: running.id }, path: "/api/x?range=24h" });
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe("ok");
    expect(r1.body.series.map((s: { name: string }) => s.name)).toEqual(["CPUUtilization", "NetworkIn", "NetworkOut", "DiskReadBytes", "DiskWriteBytes", "StatusCheckFailed"]);
    expect(r1.body.series[0].points.length).toBeGreaterThan(100);
    const r2 = await call(getMetrics, { user: owner, params: { orgId, id: stopped.id }, path: "/api/x?range=1h" });
    expect(r2.body.series.every((s: { points: unknown[] }) => s.points.length === 0)).toBe(true);
  });

  it("metrics for another tenant's resource are rejected", async () => {
    const foreign = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: otherOrgId, resourceType: "ec2:instance" } });
    expect((await call(getMetrics, { user: owner, params: { orgId, id: foreign.id }, path: "/api/x" })).status).toBe(404);
    expect((await call(getMetrics, { user: owner, params: { orgId: otherOrgId, id: foreign.id }, path: "/api/x" })).status).toBe(404);
  });

  it("billing viewer cannot read inventory or metrics", async () => {
    const billing = await addMember(owner, orgId, "BILLING_VIEWER");
    const running = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceType: "ec2:instance" } });
    expect((await call(getMetrics, { user: billing, params: { orgId, id: running.id }, path: "/api/x" })).status).toBe(403);
    expect((await call(exportReport, { user: billing, params: { orgId, report: "inventory" }, path: "/api/x" })).status).toBe(403);
  });

  it("exports CSV for authorised users; viewers and other tenants are refused", async () => {
    const res = await call(exportReport, { user: owner, params: { orgId, report: "inventory" }, path: "/api/x?type=ec2:instance" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = String(res.body).trim().split("\r\n");
    expect(lines[0]).toContain("resource_id");
    expect(lines).toHaveLength(10);
    expect(await getDb().auditLog.count({ where: { organizationId: orgId, action: "report.exported" } })).toBeGreaterThan(0);

    const viewer = await addMember(owner, orgId, "VIEWER");
    expect((await call(exportReport, { user: viewer, params: { orgId, report: "inventory" }, path: "/api/x" })).status).toBe(403);
    expect((await call(exportReport, { user: other, params: { orgId, report: "inventory" }, path: "/api/x" })).status).toBe(404);
    expect((await call(exportReport, { user: owner, params: { orgId, report: "../../etc/passwd" }, path: "/api/x" })).status).toBe(400);
    expect((await call(exportReport, { user: owner, params: { orgId, report: "inventory" }, path: "/api/x?evil=1" })).status).toBe(400);
  });
});
