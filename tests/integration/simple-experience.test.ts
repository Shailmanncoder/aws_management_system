import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POST as saveBudget, GET as readBudgets } from "@/app/api/v1/orgs/[orgId]/budget/route";
import { POST as createProject, GET as readProjects } from "@/app/api/v1/orgs/[orgId]/projects/route";
import { PATCH as updateProject, DELETE as deleteProject } from "@/app/api/v1/orgs/[orgId]/projects/[id]/route";
import { POST as assignHelp, GET as readHelp } from "@/app/api/v1/orgs/[orgId]/help/route";
import { PATCH as updateHelp } from "@/app/api/v1/orgs/[orgId]/help/[id]/route";
import { getDb } from "@/server/db";
import { authorizeOrg } from "@/server/authz/guard";
import { evaluateAlerts } from "@/server/services/alert-service";
import { getPriorities, weeklySummary } from "@/server/services/simple-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { newOrg, addMember } from "../helpers/orgs";

describe("simple experience: permissions, persistence and honest costs", () => {
  let owner: TestUser, viewer: TestUser, billing: TestUser, stranger: TestUser;
  let orgId: string, otherOrg: string, accountA: string, accountB: string, foreignAccount: string, findingId: string;
  beforeAll(async () => {
    owner = await createUser("simple-owner"); orgId = (await newOrg(owner,"Simple workspace")).id;
    viewer = await addMember(owner,orgId,"VIEWER"); billing = await addMember(owner,orgId,"BILLING_VIEWER");
    stranger = await createUser("simple-stranger"); otherOrg = (await newOrg(stranger,"Foreign workspace")).id;
    const db = getDb();
    const create = (organizationId: string, awsAccountId: string) => db.awsAccount.create({ data: { organizationId, awsAccountId, displayName: awsAccountId, costScopeVersion: 1 } });
    accountA = (await create(orgId,"120000000001")).id; accountB = (await create(orgId,"120000000002")).id; foreignAccount = (await create(otherOrg,"120000000003")).id;
    findingId = (await db.securityFinding.create({ data: { organizationId: orgId, awsAccountRefId: accountA, ruleId: "S3-PUBLIC", source: "STRATUS_RULE", fingerprint: randomUUID(), severity: "HIGH", title: "Private files may be exposed", description: "A bucket is public", rationale: "Review who can access these files", remediation: "Check bucket access", evidence: {}, region: "us-east-1" } })).id;
    const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
    for (const [account, amount, unit] of [[accountA,45,"USD"],[accountB,40,"USD"],[foreignAccount,999,"USD"]] as const) await db.costRecord.create({ data: { organizationId: account === foreignAccount ? otherOrg : orgId, awsAccountRefId: account, granularity: "DAILY", dimension: "TOTAL", dimensionKey: "total", periodStart: start, amount, unit, estimated: false } });
  });
  it("saves one workspace budget per currency and updates it without duplicates", async () => {
    for (const amount of [200,100]) expect((await call(saveBudget,{ user: owner, params:{ orgId }, body:{ amount,currency:"USD",warningPercent:80 } })).status).toBe(200);
    const r = await call(readBudgets,{ user:billing,params:{orgId} }); expect(r.body.budgets).toHaveLength(1); expect(r.body.budgets[0].amount).toBe(100);
    expect((await call(saveBudget,{user:viewer,params:{orgId},body:{amount:100,currency:"USD"}})).status).toBe(403);
    expect((await call(saveBudget,{user:owner,params:{orgId},body:{amount:-1,currency:"USD"}})).status).toBe(400);
  });
  it("warns on combined workspace spend, keeps tenants and currencies separate, and deduplicates across account syncs", async () => {
    await evaluateAlerts(orgId,accountA,new Date()); await evaluateAlerts(orgId,accountB,new Date());
    const alerts = await getDb().alert.findMany({where:{organizationId:orgId,type:"COST_THRESHOLD"}});
    expect(alerts).toHaveLength(1); expect(alerts[0].severity).toBe("MEDIUM"); expect(alerts[0].awsAccountRefId).toBeNull(); expect(alerts[0].message).toContain("85.00 USD");
    await call(saveBudget,{user:owner,params:{orgId},body:{amount:1,currency:"INR"}});
    await evaluateAlerts(orgId,accountA,new Date()); expect(await getDb().alert.count({where:{organizationId:orgId,type:"COST_THRESHOLD"}})).toBe(1);
    await getDb().costRecord.updateMany({where:{organizationId:orgId,awsAccountRefId:accountB},data:{amount:65}});
    await evaluateAlerts(orgId,accountB,new Date()); expect(await getDb().alert.count({where:{organizationId:orgId,type:"COST_THRESHOLD",severity:"HIGH"}})).toBe(1);
  });
  it("groups accounts exclusively, prevents foreign account assignment, and preserves accounts on deletion", async () => {
    const body = { name:"Company website",owner:"Website team",accountIds:[accountA] };
    const p = await call(createProject,{user:owner,params:{orgId},body}); expect(p.status).toBe(200);
    expect((await call(createProject,{user:owner,params:{orgId},body})).status).toBe(409);
    expect((await call(createProject,{user:owner,params:{orgId},body:{...body,accountIds:[foreignAccount]}})).status).toBe(404);
    expect((await call(createProject,{user:viewer,params:{orgId},body})).status).toBe(403);
    expect((await call(updateProject,{method:"PATCH",user:stranger,params:{orgId:otherOrg,id:p.body.id},body})).status).toBe(404);
    const r = await call(readProjects,{user:billing,params:{orgId}}); expect(r.body.projects[0].totals).toEqual([{currency:"USD",amount:45}]);
    expect((await call(readProjects,{user:stranger,params:{orgId:otherOrg}})).body.projects).toEqual([]);
    expect((await call(deleteProject,{method:"DELETE",user:owner,params:{orgId,id:p.body.id}})).status).toBe(200);
    expect(await getDb().awsAccount.findUnique({where:{id:accountA}})).not.toBeNull();
  });
  it("checks both requester and recipient access, and keeps help requests tenant scoped", async () => {
    const body = { kind:"security",targetId:findingId,assigneeId:owner.id,note:"Please review these files" };
    expect((await call(assignHelp,{user:viewer,params:{orgId},body})).status).toBe(403);
    expect((await call(assignHelp,{user:owner,params:{orgId},body:{...body,assigneeId:billing.id}})).status).toBe(400);
    expect((await call(assignHelp,{user:owner,params:{orgId},body:{...body,assigneeId:stranger.id}})).status).toBe(400);
    const r = await call(assignHelp,{user:owner,params:{orgId},body}); expect(r.status).toBe(200);
    expect((await call(readHelp,{user:billing,params:{orgId}})).body.requests).toHaveLength(0);
    expect((await call(readHelp,{user:stranger,params:{orgId:otherOrg}})).body.requests).toHaveLength(0);
    expect((await call(updateHelp,{method:"PATCH",user:stranger,params:{orgId:otherOrg,id:r.body.id},body:{status:"DONE"}})).status).toBe(404);
    expect((await call(updateHelp,{method:"PATCH",user:owner,params:{orgId,id:r.body.id},body:{status:"DONE"}})).status).toBe(200);
    expect((await getDb().securityFinding.findUniqueOrThrow({where:{id:findingId}})).status).toBe("OPEN");
  });
  it("does not reveal security findings in priorities or weekly summaries to billing viewers", async () => {
    const access = await authorizeOrg(billing.id,orgId,"org:read");
    expect((await getPriorities(access)).actions.some(a => a.kind === "security")).toBe(false);
    const summary = await weeklySummary(access,0); expect(summary.newIssues).toBeNull(); expect(summary.added).toBeNull();
    const ownerAccess = await authorizeOrg(owner.id,orgId,"org:read");
    expect((await getPriorities(ownerAccess)).actions[0].kind).toBe("security");
  });
});

describe("immediate job scheduling", () => {
  it("uses the database clock for default runAfter and preserves explicit future scheduling", async () => {
    const { enqueueJob, claimNextJob } = await import("@/server/jobs/queue");
    const user = await createUser("queue-clock"), orgId = (await newOrg(user,"Queue clock")).id;
    const immediate = await enqueueJob({ organizationId:orgId,awsAccountRefId:null,type:"COST_SYNC",trigger:"SYSTEM" });
    expect(immediate.job.runAfter).toEqual(immediate.job.createdAt);
    expect((await claimNextJob("clock-test",{organizationId:orgId}))?.id).toBe(immediate.job.id);
    const future = new Date(Date.now()+3600_000);
    const delayed = await enqueueJob({ organizationId:orgId,awsAccountRefId:null,type:"INVENTORY_SYNC",trigger:"SCHEDULED",runAfter:future });
    expect(delayed.job.runAfter).toEqual(future);
    expect(await claimNextJob("clock-test",{organizationId:orgId})).toBeNull();
  });
});
