import type { Prisma } from "@/generated/prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { openAwsSession } from "@/server/services/aws-session-service";
import { runSecurityScan } from "@/server/sync/security-sync";
import { PATCH } from "@/app/api/v1/orgs/[orgId]/security/[id]/route";
import { authorizeOrg } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { listSecurityFindings } from "@/server/services/findings-service";
import { call, createUser, type TestUser } from "../helpers/app";
import { drainJobs } from "../helpers/jobs";
import { addMember, connectFixtureAccount, newOrg } from "../helpers/orgs";

 describe("Security Center tenant boundaries and worker integration", () => {
  let owner: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let foreignId: string;
  let findingId: string;
  beforeAll(async () => {
    owner = await createUser("security-owner");
    orgId = (await newOrg(owner, "Security Org")).id;
    foreignId = (await newOrg(owner, "Foreign Security Org")).id;
    viewer = await addMember(owner, orgId, "VIEWER");
    await connectFixtureAccount(owner, orgId, "123456789012");
    await drainJobs(orgId);
    findingId = (await getDb().securityFinding.findFirstOrThrow({ where: { organizationId: orgId, source: "STRATUS_RULE" } })).id;
  });
  it("creates local and imported findings with evidence, and records scan coverage", async () => {
    const access = await authorizeOrg(owner.id, orgId, "security:read");
    const result = await listSecurityFindings(access, {});
    expect(result.total).toBeGreaterThan(0);
    expect(result.accounts[0]?.securityScannedAt).not.toBeNull();
    expect(await getDb().securityFinding.count({ where: { organizationId: orgId, source: "GUARDDUTY" } })).toBeGreaterThan(0);
    expect(await getDb().securityFinding.count({ where: { organizationId: orgId, source: "SECURITY_HUB" } })).toBeGreaterThan(0);
    for (const finding of result.items) {
      expect(finding.organizationId).toBe(orgId);
      expect(finding.remediation).toBeTruthy();
    }
  });
  it("returns no results for a foreign account filter", async () => {
    const access = await authorizeOrg(owner.id, orgId, "security:read");
    expect((await listSecurityFindings(access, { account: foreignId })).total).toBe(0);
  });
  it("denies readers without security permission", async () => {
    const access = await authorizeOrg(viewer.id, orgId, "inventory:read");
    await expect(listSecurityFindings(access, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies viewer suppression and cross-tenant finding IDs", async () => {
    const body = { status: "SUPPRESSED", reason: "Accepted for a test" };
    const denied = await call(PATCH, { method: "PATCH", user: viewer, params: { orgId, id: findingId }, body });
    expect(denied.status).toBe(403);
    const foreign = await call(PATCH, { method: "PATCH", user: owner, params: { orgId: foreignId, id: findingId }, body });
    expect(foreign.status).toBe(404);
  });
  it("suppresses and reopens findings with an audit trail", async () => {
    const res = await call(PATCH, { method: "PATCH", user: owner, params: { orgId, id: findingId }, body: { status: "SUPPRESSED", reason: "Risk accepted temporarily" } });
    expect(res.status).toBe(200);
    expect((await getDb().securityFinding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("SUPPRESSED");
    expect(await getDb().auditLog.count({ where: { organizationId: orgId, action: "finding.suppressed", targetId: findingId } })).toBe(1);
    const reopened = await call(PATCH, { method: "PATCH", user: owner, params: { orgId, id: findingId }, body: { status: "OPEN", reason: "Review acceptance again" } });
    expect(reopened.status).toBe(200);
  });
  it("deduplicates repeated scans, retains stale findings, resolves and reopens confirmed risks", async () => {
    const db = getDb();
    const resource = await db.awsResource.findFirstOrThrow({ where: { organizationId: orgId, resourceType: "ec2:volume", attributes: { path: ["encrypted"], equals: false } } });
    const finding = await db.securityFinding.findFirstOrThrow({ where: { organizationId: orgId, resourceRefId: resource.id, ruleId: "EBS-UNENCRYPTED" } });
    const opened = await openAwsSession(orgId, resource.awsAccountRefId, "sync");
    const scan = (inventoryStartedAt = new Date(0)) => runSecurityScan({ organizationId: orgId, accountRefId: resource.awsAccountRefId, session: opened.session, regions: opened.regions, inventoryStartedAt, heartbeat: async () => true });
    try {
      const count = await db.securityFinding.count({ where: { organizationId: orgId } });
      await scan();
      expect(await db.securityFinding.count({ where: { organizationId: orgId } })).toBe(count);
      await db.awsResource.update({ where: { id: resource.id }, data: { attributes: { ...(resource.attributes as Prisma.JsonObject), encrypted: true } } });
      await scan(new Date(Date.now() + 1000));
      expect((await db.securityFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
      await scan();
      expect((await db.securityFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("RESOLVED");
      await db.awsResource.update({ where: { id: resource.id }, data: { attributes: resource.attributes as Prisma.InputJsonValue } });
      await scan();
      expect((await db.securityFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
      await db.securityFinding.update({ where: { id: finding.id }, data: { status: "SUPPRESSED" } });
      await scan();
      expect((await db.securityFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("SUPPRESSED");
    } finally { opened.session.dispose(); }
  });

});
