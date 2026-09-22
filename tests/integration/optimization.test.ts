import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as patchRec } from "@/app/api/v1/orgs/[orgId]/optimization/[id]/route";
import { getDb } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

describe("optimization analysis", () => {
  let owner: TestUser;
  let orgId: string;
  let accountId: string;

  beforeAll(async () => {
    owner = await createUser("opt");
    orgId = (await newOrg(owner, "Opt Org")).id;
    accountId = (await connectFixtureAccount(owner, orgId, "123456789012")).accountId;
    await drainJobs(orgId);
  });

  it("produces evidence-backed recommendations after sync", async () => {
    const recs = await getDb().optimizationFinding.findMany({ where: { organizationId: orgId, status: "OPEN" } });
    const rules = new Set(recs.map((r) => r.ruleId));
    for (const r of ["EBS-UNATTACHED", "EBS-GP2-TO-GP3", "EIP-UNASSOCIATED", "SNAPSHOT-OLD", "EC2-STOPPED-LONG", "S3-NO-LIFECYCLE", "TAGS-MISSING"]) expect(rules).toContain(r);
    expect(recs.some((r) => r.ruleId === "EC2-IDLE" || r.ruleId === "EC2-UNDERUTILIZED")).toBe(true);
    const orphan = recs.find((r) => r.ruleId === "EBS-UNATTACHED" && r.title.includes("vol-0orphan0001"))!;
    expect(Number(orphan.estimatedMonthlySavings)).toBe(25); // 250 GiB gp2 × $0.10
    expect(orphan.dataBasis).toBe("ESTIMATED");
    for (const r of recs) {
      expect(r.reason.length).toBeGreaterThan(10);
      expect(r.recommendation.length).toBeGreaterThan(10);
      expect(r.limitations.length).toBeGreaterThan(10);
    }
    expect(await getDb().metricSummary.count({ where: { organizationId: orgId, metricName: "CPUUtilization" } })).toBeGreaterThan(0);
  });

  it("re-analysis is idempotent and dismissals persist", async () => {
    const rec = await getDb().optimizationFinding.findFirstOrThrow({ where: { organizationId: orgId, ruleId: "S3-NO-LIFECYCLE" } });
    const res = await call(patchRec, { method: "PATCH", user: owner, params: { orgId, id: rec.id }, body: { status: "SUPPRESSED", reason: "Intentional: hot bucket" } });
    expect(res.status).toBe(200);
    const before = await getDb().optimizationFinding.count({ where: { organizationId: orgId } });
    await enqueueJob({ organizationId: orgId, awsAccountRefId: accountId, type: "INVENTORY_SYNC", trigger: "MANUAL" });
    await drainJobs(orgId);
    expect(await getDb().optimizationFinding.count({ where: { organizationId: orgId } })).toBe(before);
    expect((await getDb().optimizationFinding.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("SUPPRESSED");
  });

  it("dismissal requires optimization:manage and is tenant-scoped", async () => {
    const rec = await getDb().optimizationFinding.findFirstOrThrow({ where: { organizationId: orgId, status: "OPEN" } });
    const viewer = await addMember(owner, orgId, "VIEWER");
    expect((await call(patchRec, { method: "PATCH", user: viewer, params: { orgId, id: rec.id }, body: { status: "SUPPRESSED", reason: "nope nope" } })).status).toBe(403);
    const other = await createUser("opt-other");
    const otherOrg = (await newOrg(other, "Other opt")).id;
    expect((await call(patchRec, { method: "PATCH", user: other, params: { orgId: otherOrg, id: rec.id }, body: { status: "SUPPRESSED", reason: "cross tenant" } })).status).toBe(404);
  });
});
