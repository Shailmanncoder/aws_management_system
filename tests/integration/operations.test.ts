import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GET, POST } from "@/app/api/v1/orgs/[orgId]/operations/route";
import { POST as action, PATCH, DELETE } from "@/app/api/v1/orgs/[orgId]/operations/[id]/route";
import { getDb } from "@/server/db";
import { persistCollectorResult } from "@/server/sync/persist";
import { authorizeOrg } from "@/server/authz/guard";
import { listInventory } from "@/server/services/inventory-service";
import { runScheduledOperations } from "@/server/services/operation-plan-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { newOrg, addMember } from "../helpers/orgs";

describe("operations tenancy, evidence and reviewed workflows", () => {
  let owner: TestUser, admin: TestUser, viewer: TestUser, billing: TestUser, outsider: TestUser;
  let orgId: string, otherOrg: string, accountId: string, resourceId: string, foreignId: string;
  beforeAll(async () => {
    owner = await createUser("ops-owner"); orgId = (await newOrg(owner, "Operations workspace")).id;
    admin = await addMember(owner, orgId, "ADMIN"); viewer = await addMember(owner, orgId, "VIEWER"); billing = await addMember(owner, orgId, "BILLING_VIEWER");
    outsider = await createUser("ops-outsider"); otherOrg = (await newOrg(outsider, "Other operations")).id;
    const db = getDb();
    accountId = (await db.awsAccount.create({ data: { organizationId: orgId, awsAccountId: "230000000001", displayName: "Operations account", costScopeVersion: 1 } })).id;
    const foreignAccount = (await db.awsAccount.create({ data: { organizationId: otherOrg, awsAccountId: "230000000002", displayName: "Foreign account" } })).id;
    for (const [org, account, native] of [[orgId, accountId, "i-ops"], [otherOrg, foreignAccount, "i-foreign"]]) {
      const r = await db.awsResource.create({ data: { organizationId: org!, awsAccountRefId: account!, resourceId: native!, resourceType: "ec2:instance", region: "us-east-1", name: native!, state: "running", attributes: { vpcId: "vpc-a" }, searchText: native! } });
      if (org === orgId) resourceId = r.id; else foreignId = r.id;
    }
  });
  const save = (user: TestUser, input: unknown) => call(POST, { user, params: { orgId }, body: { command: "save", input } });
  it("saves personal views across devices and hides them from other members", async () => {
    const r = await save(viewer, { kind: "VIEW", name: "Personal", shared: false, payload: { path: "/resources", query: "q=ops&page=5&redirect=bad" } });
    expect(r.status).toBe(200); expect(r.body.payload.query).toBe("q=ops");
    expect((await call(GET, { user: viewer, params: { orgId } })).body.records.some((v: { id: string }) => v.id === r.body.id)).toBe(true);
    expect((await call(GET, { user: owner, params: { orgId } })).body.records.some((v: { id: string }) => v.id === r.body.id)).toBe(false);
    expect((await save(viewer, { kind: "VIEW", name: "Shared", shared: true, payload: { path: "/resources", query: "" } })).status).toBe(403);
  });
  it("enforces ownership permissions, tenant references, and unowned inventory filters", async () => {
    const input = { kind: "OWNER", name: "Web owner", payload: { resourceId, owner: "Web team", team: "Product" } };
    expect((await save(viewer, input)).status).toBe(403);
    expect((await save(owner, { ...input, payload: { ...input.payload, resourceId: foreignId } })).status).toBe(404);
    const r = await save(owner, input); expect(r.status).toBe(200);
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    expect((await listInventory(access, ["ec2:instance"], { unowned: "true" })).items).toHaveLength(0);
    expect((await call(DELETE, { method: "DELETE", user: outsider, params: { orgId: otherOrg, id: r.body.id } })).status).toBe(404);
    expect((await call(GET, { user: billing, params: { orgId } })).body.resources).toEqual([]);
  });
  it("captures drift baselines server-side and rejects stale edits", async () => {
    const input = { kind: "BASELINE", name: "Reviewed", payload: { resourceId } };
    const r = await save(owner, input); expect(r.status).toBe(200);
    expect(r.body.payload.snapshot.state).toBe("running");
    await getDb().awsResource.update({ where: { id: resourceId }, data: { state: "stopped" } });
    expect((await call(GET, { user: owner, params: { orgId } })).body.baselines[0].changes).toContain("state");
    expect((await call(PATCH, { method: "PATCH", user: owner, params: { orgId, id: r.body.id }, body: { input, version: 1 } })).status).toBe(200);
    expect((await call(PATCH, { method: "PATCH", user: owner, params: { orgId, id: r.body.id }, body: { input, version: 1 } })).status).toBe(409);
  });
  it("requires separate approval, prevents repeat transitions and expires missed schedules", async () => {
    const r = await call(POST, { user: owner, params: { orgId }, body: { command: "plan", input: { name: "Start development", resourceIds: [resourceId], action: "start", timezone: "Asia/Kolkata" } } });
    expect(r.status).toBe(200); expect(r.body.status).toBe("PENDING");
    const invoke = (user: TestUser, value: string) => call(action, { user, params: { orgId, id: r.body.id }, body: { action: value } });
    expect((await invoke(owner, "approve")).status).toBe(409);
    expect((await invoke(viewer, "approve")).status).toBe(403);
    expect((await invoke(admin, "approve")).status).toBe(200);
    expect((await invoke(admin, "approve")).status).toBe(409);
    expect((await invoke(owner, "execute")).status).toBe(412); // fixture mode cannot mutate AWS
    await getDb().operationPlan.update({ where: { id: r.body.id }, data: { expiresAt: new Date(0) } });
    await runScheduledOperations();
    expect((await getDb().operationPlan.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe("EXPIRED");
  });
  it("records only observed inventory differences and confirmed deletions", async () => {
    const scope = { organizationId: orgId, awsAccountRefId: accountId, awsAccountId: "230000000001" };
    const resource = { resourceType: "ec2:instance" as const, region: "us-east-1", resourceId: "i-history", arn: null, name: "History", state: "running", attributes: {}, tags: { env: "dev" } };
    const result = { resources: [resource], resourceTypes: ["ec2:instance" as const], region: "us-east-1" };
    await persistCollectorResult(scope, result, new Date(0));
    await persistCollectorResult(scope, result, new Date(0));
    const stored = await getDb().awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceId: "i-history" } });
    expect(await getDb().resourceChange.count({ where: { resourceId: stored.id } })).toBe(1);
    await persistCollectorResult(scope, { ...result, resources: [{ ...resource, tags: { env: "production" } }] }, new Date(0));
    expect(await getDb().resourceChange.count({ where: { resourceId: stored.id, kind: "CHANGED" } })).toBe(1);
    await persistCollectorResult(scope, { ...result, resources: [] }, new Date(Date.now() + 1000));
    expect(await getDb().resourceChange.count({ where: { resourceId: stored.id, kind: "DELETED" } })).toBe(1);
  });
  it("rejects unknown types, external URLs, unverified recipients and foreign resources", async () => {
    expect((await save(owner, { kind: "ROOT", name: "bad", payload: {} })).status).toBe(400);
    expect((await save(owner, { kind: "VIEW", name: "bad", shared: true, payload: { path: "https://example.com", query: "" } })).status).toBe(400);
    expect((await save(owner, { kind: "NOTIFICATION", name: "mail", payload: { memberId: outsider.id } })).status).toBe(400);
    expect((await save(owner, { kind: "INCIDENT", name: "incident", payload: { resourceIds: [foreignId], assigneeId: owner.id, status: "OPEN", note: "Investigate" } })).status).toBe(404);
    expect((await call(POST, { user: owner, params: { orgId }, body: { command: "plan", input: { name: "foreign", resourceIds: [randomUUID()], action: "stop" } } })).status).toBe(404);
  });
});
