import { beforeAll, describe, expect, it } from "vitest";
import { isWorldOpen } from "@/lib/network";
import type { SecurityGroupAttrs } from "@/lib/resource-types";
import { getWalkthrough, resolveTokens } from "@/lib/walkthroughs";
import { authorizeOrg } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { getWalkthroughContext } from "@/server/services/walkthrough-service";
import { createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

describe("guided walkthrough personalisation", () => {
  let owner: TestUser;
  let orgId: string;
  let otherOrgId: string;
  let other: TestUser;

  beforeAll(async () => {
    owner = await createUser("guide");
    orgId = (await newOrg(owner, "Guide Org")).id;
    await connectFixtureAccount(owner, orgId, "123456789012");
    await drainJobs(orgId);
    other = await createUser("guide-other");
    otherOrgId = (await newOrg(other, "Other Guide Org")).id;
  });

  it("fills the steps with the workspace's own VPC and subnet ids", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const ctx = await getWalkthroughContext(access);

    expect(ctx.vpcId).toMatch(/^vpc-/);
    expect(ctx.subnetId).toMatch(/^subnet-/);
    expect(ctx.region).toBeTruthy();

    const vpc = await getDb().awsResource.findFirst({ where: { organizationId: orgId, resourceId: ctx.vpcId! }, select: { organizationId: true, region: true } });
    expect(vpc?.organizationId).toBe(orgId);
    expect(vpc?.region).toBe(ctx.region);

    const step = getWalkthrough("ec2-launch-instance")!.steps.find((s) => s.actions.some((a) => a.includes("{{vpcId}}")))!;
    const rendered = step.actions.map((a) => resolveTokens(a, ctx)).join(" ");
    expect(rendered).toContain(ctx.vpcId!);
    expect(rendered).not.toContain("{{");
  });

  it("never suggests a security group that is open to the internet", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const ctx = await getWalkthroughContext(access);
    if (!ctx.securityGroupId) return; // No suitable group in the fixture estate is a valid outcome.

    const sg = await getDb().awsResource.findFirst({
      where: { organizationId: orgId, resourceId: ctx.securityGroupId, resourceType: "ec2:security-group" },
      select: { attributes: true, name: true },
    });
    expect(sg).not.toBeNull();
    const attrs = sg!.attributes as unknown as SecurityGroupAttrs;
    expect(attrs.ingress.some(isWorldOpen)).toBe(false);
    expect(sg!.name).not.toBe("default");
  });

  it("honours a requested region and ignores one that is not a real AWS region", async () => {
    const access = await authorizeOrg(owner.id, orgId, "inventory:read");
    const real = await getWalkthroughContext(access, { region: "eu-west-1" });
    expect(real.region).toBe("eu-west-1");

    const bogus = await getWalkthroughContext(access, { region: "evil.example.com" });
    expect(bogus.region).not.toBe("evil.example.com");
  });

  it("never leaks another organisation's resource ids", async () => {
    const ownerAccess = await authorizeOrg(owner.id, orgId, "inventory:read");
    const ownerCtx = await getWalkthroughContext(ownerAccess);

    const otherAccess = await authorizeOrg(other.id, otherOrgId, "inventory:read");
    const otherCtx = await getWalkthroughContext(otherAccess);

    // The second workspace has no synced inventory, so it gets placeholders, never the first's ids.
    expect(otherCtx.vpcId).toBeUndefined();
    expect(otherCtx.subnetId).toBeUndefined();
    expect(otherCtx.securityGroupId).toBeUndefined();

    const rendered = resolveTokens("VPC {{vpcId}} subnet {{subnetId}}", otherCtx);
    expect(rendered).not.toContain(ownerCtx.vpcId!);
    expect(rendered).toContain("[your VPC id");
  });

  it("requires inventory:read", async () => {
    // BILLING_VIEWER can read cost but has no inventory permission at all.
    const billingOnly = await addMember(owner, orgId, "BILLING_VIEWER");
    const access = await authorizeOrg(billingOnly.id, orgId, "org:read");
    await expect(getWalkthroughContext(access)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
