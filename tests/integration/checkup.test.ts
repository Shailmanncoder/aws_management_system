import { beforeAll, describe, expect, it } from "vitest";
import { POST as enableRecommended } from "@/app/api/v1/orgs/[orgId]/alert-rules/recommended/route";
import { authorizeOrg } from "@/server/authz/guard";
import { getCheckup } from "@/server/services/checkup-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

const find = (results: Awaited<ReturnType<typeof getCheckup>>["results"], id: string) => results.find((r) => r.id === id);

describe("account check-up", () => {
  let owner: TestUser;
  let orgId: string;
  let emptyOwner: TestUser;
  let emptyOrgId: string;

  beforeAll(async () => {
    owner = await createUser("checkup");
    orgId = (await newOrg(owner, "Checkup Org")).id;
    await connectFixtureAccount(owner, orgId, "123456789012");
    await drainJobs(orgId);

    emptyOwner = await createUser("checkup-empty");
    emptyOrgId = (await newOrg(emptyOwner, "Empty Checkup Org")).id;
  });

  it("tells a brand-new workspace to connect an account first", async () => {
    const access = await authorizeOrg(emptyOwner.id, emptyOrgId, "inventory:read");
    const { results, nothingExaminedYet } = await getCheckup(access);

    const connect = find(results, "connectAccount")!;
    expect(connect.ok).toBe(false);
    expect(connect.urgency).toBe("now");
    expect(nothingExaminedYet).toBe(true);
  });

  it("never claims things are safe before it has looked", async () => {
    const access = await authorizeOrg(emptyOwner.id, emptyOrgId, "inventory:read");
    const { results } = await getCheckup(access);

    // The safety checks must be "not checked yet", never a clean bill of health.
    for (const id of ["publicStorage", "openPorts", "noEncryption", "noBackups"]) {
      const check = find(results, id)!;
      expect(check.unknown, `${id} must be marked unknown`).toBe(true);
      expect(check.ok, `${id} must not report ok`).toBe(false);
    }
  });

  it("reports the real problems found in a synced account", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const { results, counts } = await getCheckup(access);

    const publicStorage = find(results, "publicStorage")!;
    expect(publicStorage.unknown).toBe(false);
    // The fixture estate has a deliberately public bucket and wide-open security groups.
    expect(publicStorage.ok).toBe(false);
    expect(publicStorage.detail).toMatch(/storage folder/);
    expect(publicStorage.guideId).toBe("fix-s3-public-access");

    const openPorts = find(results, "openPorts")!;
    expect(openPorts.ok).toBe(false);
    expect(openPorts.urgency).toBe("now");

    expect(counts.now).toBeGreaterThan(0);
    expect(counts.now + counts.soon + counts.whenever + counts.done).toBe(results.length);
  });

  it("counts things in plain words, not codes", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const { results } = await getCheckup(access);
    for (const r of results) {
      expect(r.detail).not.toMatch(/S3-|SG-|EBS-|RDS-|CRITICAL|HIGH/);
    }
  });

  it("flips the alerts check to done once Stratus switches them on", async () => {
    // Connecting an account already seeds the recommended rules, so the transition is only
    // observable on a workspace that has never connected one.
    const before = await getCheckup(await authorizeOrg(emptyOwner.id, emptyOrgId, "inventory:read"));
    expect(find(before.results, "noAlerts")!.ok).toBe(false);

    const res = await call(enableRecommended, { user: emptyOwner, params: { orgId: emptyOrgId }, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.created).toBeGreaterThan(0);

    const after = await getCheckup(await authorizeOrg(emptyOwner.id, emptyOrgId, "inventory:read"));
    const alerts = find(after.results, "noAlerts")!;
    expect(alerts.ok).toBe(true);
    expect(alerts.urgency).toBe("done");
    expect(alerts.detail).toMatch(/alerts? (is|are) on/);
  });

  it("already has alerts on for a workspace with a connected account", async () => {
    // Connecting the first account seeds them, so this check should not nag a normal user.
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    expect(find((await getCheckup(access)).results, "noAlerts")!.ok).toBe(true);
  });

  it("never reports another workspace's problems", async () => {
    const access = await authorizeOrg(emptyOwner.id, emptyOrgId, "inventory:read");
    const { results } = await getCheckup(access);
    // The other workspace has public storage; this one has no account at all.
    expect(find(results, "publicStorage")!.detail).toBe("");
    expect(find(results, "connectAccount")!.detail).toBe("");
  });

  it("requires permission to read inventory", async () => {
    const billingOnly = await addMember(owner, orgId, "BILLING_VIEWER");
    const access = await authorizeOrg(billingOnly.id, orgId, "org:read");
    await expect(getCheckup(access)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
