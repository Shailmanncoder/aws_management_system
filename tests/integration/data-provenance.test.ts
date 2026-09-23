import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { listAccounts } from "@/server/repositories/aws-account-repository";
import { createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { connectFixtureAccount, newOrg } from "../helpers/orgs";

/**
 * The "synthetic data" warning must describe the data that is stored, not the mode the process
 * happens to run in. Restoring a real database into a fixture-configured deployment previously
 * made the UI declare genuine AWS data to be fake.
 */
describe("data provenance", () => {
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("provenance");
    orgId = (await newOrg(owner, "Provenance Org")).id;
    await connectFixtureAccount(owner, orgId, "123456789012");
    await drainJobs(orgId);
  });

  it("marks data as synthetic when a fixture-mode sync produced it", async () => {
    // The integration suite runs in fixture mode, so a synced account must be labelled.
    const accounts = await listAccounts(orgId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.syntheticData).toBe(true);
  });

  it("does not label restored real data as synthetic", async () => {
    // Simulates a production copy restored into this deployment: the rows say where they came
    // from, so the warning disappears even though the process is still configured for fixtures.
    await getDb().awsAccount.updateMany({ where: { organizationId: orgId }, data: { syntheticData: false } });
    const accounts = await listAccounts(orgId);
    expect(accounts.every((a) => a.syntheticData)).toBe(false);
  });

  it("defaults to real, because every existing row was synced against a real account", async () => {
    const fresh = await createUser("provenance-fresh");
    const freshOrg = (await newOrg(fresh, "Fresh Provenance Org")).id;
    await connectFixtureAccount(fresh, freshOrg, "210987654321");
    // Before any sync has run, nothing has been produced, so nothing is claimed either way.
    const accounts = await listAccounts(freshOrg);
    expect(accounts[0]!.syntheticData).toBe(false);
    expect(accounts[0]!.syncStatus).not.toBe("SUCCEEDED");
  });
});
