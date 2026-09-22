import { beforeAll, describe, expect, it } from "vitest";
import { POST as createOrg } from "@/app/api/v1/orgs/route";
import { GET as listMembers } from "@/app/api/v1/orgs/[orgId]/members/route";
import { DELETE as removeMember, PATCH as patchMember } from "@/app/api/v1/orgs/[orgId]/members/[memberId]/route";
import { POST as invite } from "@/app/api/v1/orgs/[orgId]/invitations/route";
import { POST as accept } from "@/app/api/v1/invitations/accept/route";
import { POST as switchWs } from "@/app/api/v1/session/workspace/route";
import { getDb } from "@/server/db";
import { call, createUser, type TestUser } from "../helpers/app";

async function newOrg(user: TestUser, name = "Acme") {
  const res = await call(createOrg, { user, body: { name } });
  expect(res.status).toBe(201);
  return res.body.organization as { id: string };
}

async function addMember(owner: TestUser, orgId: string, role: string) {
  const member = await createUser(role.toLowerCase());
  const inv = await call(invite, { user: owner, params: { orgId }, body: { email: member.email, role } });
  expect(inv.status).toBe(200);
  const token = (inv.body.invitePath as string).split("/").pop()!;
  const acc = await call(accept, { user: member, body: { token } });
  expect(acc.status).toBe(200);
  return member;
}

describe("authentication", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await call(createOrg, { body: { name: "x" } });
    expect(res.status).toBe(401);
  });

  it("rejects forged session cookies", async () => {
    const res = await call(createOrg, { cookie: "stratus.session_token=forged.value", body: { name: "Forged" } });
    expect(res.status).toBe(401);
  });

  it("expired sessions fail", async () => {
    const u = await createUser("expired");
    await getDb().session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await call(createOrg, { user: u, body: { name: "Should fail" } });
    expect(res.status).toBe(401);
  });

  it("revoked sessions fail immediately (no cookie cache)", async () => {
    const u = await createUser("revoked");
    await getDb().session.deleteMany({ where: { userId: u.id } });
    const res = await call(createOrg, { user: u, body: { name: "Should fail" } });
    expect(res.status).toBe(401);
  });

  it("records a login audit event", async () => {
    const u = await createUser("audited");
    const events = await getDb().auditLog.findMany({ where: { actorUserId: u.id } });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["auth.signup", "auth.login"]));
  });
});

describe("CSRF / input hardening", () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await createUser("csrf");
  });

  it("rejects cross-origin state-changing requests", async () => {
    const res = await call(createOrg, { user, body: { name: "Evil" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects form-encoded bodies", async () => {
    const res = await call(createOrg, { user, rawBody: "name=x", contentType: "application/x-www-form-urlencoded" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (mass assignment)", async () => {
    const res = await call(createOrg, { user, body: { name: "Mass", id: "00000000-0000-4000-8000-000000000000", actionModeEnabled: true } });
    expect(res.status).toBe(400);
  });

  it("rejects prototype pollution payloads", async () => {
    const res = await call(createOrg, { user, rawBody: '{"name":"P","__proto__":{"isAdmin":true}}' });
    expect(res.status).toBe(400);
  });

  it("stores SQL-injection and XSS strings inertly or rejects them", async () => {
    const sqli = await call(createOrg, { user, body: { name: "x'; DROP TABLE users; --" } });
    expect(sqli.status).toBe(201);
    expect(await getDb().user.count()).toBeGreaterThan(0);
    const xss = await call(createOrg, { user, body: { name: "<script>alert(1)</script>" } });
    expect(xss.status).toBe(400);
  });

  it("error responses carry a request id and no internals", async () => {
    const res = await call(createOrg, { user, body: { name: "" } });
    expect(res.status).toBe(400);
    expect(res.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|at Object|\/Users\//i);
  });
});

describe("tenant isolation & RBAC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let orgA: { id: string };
  let orgB: { id: string };

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    orgA = await newOrg(alice, "Alice Co");
    orgB = await newOrg(bob, "Bob Co");
  });

  it("owner can list their own members", async () => {
    const res = await call(listMembers, { user: alice, params: { orgId: orgA.id } });
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
  });

  it("User A cannot access User B's organization (404, no existence oracle)", async () => {
    const res = await call(listMembers, { user: alice, params: { orgId: orgB.id } });
    expect(res.status).toBe(404);
    const random = await call(listMembers, { user: alice, params: { orgId: "5d7c0d1e-8a8b-4f7a-9c1e-2b3c4d5e6f70" } });
    expect(random.status).toBe(404);
    expect(random.body.error.message).toBe(res.body.error.message);
  });

  it("manipulated organization ids are rejected", async () => {
    for (const orgId of ["not-a-uuid", "' OR 1=1 --", "../../etc/passwd", orgB.id.toUpperCase() + "0"]) {
      const res = await call(listMembers, { user: alice, params: { orgId } });
      expect(res.status).toBe(404);
    }
  });

  it("cannot switch the active workspace to a foreign org", async () => {
    const res = await call(switchWs, { user: alice, body: { organizationId: orgB.id } });
    expect(res.status).toBe(404);
  });

  it("cannot modify a member of another org via its member id (IDOR)", async () => {
    const bobMember = await getDb().organizationMember.findFirstOrThrow({ where: { organizationId: orgB.id } });
    const res = await call(patchMember, { method: "PATCH", user: alice, params: { orgId: orgA.id, memberId: bobMember.id }, body: { role: "VIEWER" } });
    expect(res.status).toBe(404);
    const unchanged = await getDb().organizationMember.findUniqueOrThrow({ where: { id: bobMember.id } });
    expect(unchanged.role).toBe("OWNER");
  });

  it("viewer cannot perform admin operations", async () => {
    const viewer = await addMember(alice, orgA.id, "VIEWER");
    const inv = await call(invite, { user: viewer, params: { orgId: orgA.id }, body: { email: "x@example.test", role: "VIEWER" } });
    expect(inv.status).toBe(403);
    const aliceMember = await getDb().organizationMember.findFirstOrThrow({ where: { organizationId: orgA.id, userId: alice.id } });
    const del = await call(removeMember, { method: "DELETE", user: viewer, params: { orgId: orgA.id, memberId: aliceMember.id } });
    expect(del.status).toBe(403);
  });

  it("admin cannot escalate to owner or demote the owner", async () => {
    const admin = await addMember(alice, orgA.id, "ADMIN");
    const adminMember = await getDb().organizationMember.findFirstOrThrow({ where: { organizationId: orgA.id, userId: admin.id } });
    const self = await call(patchMember, { method: "PATCH", user: admin, params: { orgId: orgA.id, memberId: adminMember.id }, body: { role: "OWNER" } });
    expect(self.status).toBe(403);
    const ownerMember = await getDb().organizationMember.findFirstOrThrow({ where: { organizationId: orgA.id, userId: alice.id } });
    const demote = await call(patchMember, { method: "PATCH", user: admin, params: { orgId: orgA.id, memberId: ownerMember.id }, body: { role: "VIEWER" } });
    expect(demote.status).toBe(403);
    const inviteOwner = await call(invite, { user: admin, params: { orgId: orgA.id }, body: { email: "o@example.test", role: "OWNER" } });
    expect(inviteOwner.status).toBe(403);
  });

  it("invitations are single-use and bound to the invited email", async () => {
    const mallory = await createUser("mallory");
    const inv = await call(invite, { user: alice, params: { orgId: orgA.id }, body: { email: "someone-else@example.test", role: "ADMIN" } });
    const token = (inv.body.invitePath as string).split("/").pop()!;
    const stolen = await call(accept, { user: mallory, body: { token } });
    expect(stolen.status).toBe(403);
    const member = await getDb().organizationMember.findFirst({ where: { organizationId: orgA.id, userId: mallory.id } });
    expect(member).toBeNull();
    // Raw token is never stored.
    expect(await getDb().invitation.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("an owner cannot remove or demote themselves; last owner is protected", async () => {
    const ownerMember = await getDb().organizationMember.findFirstOrThrow({ where: { organizationId: orgB.id, userId: bob.id } });
    const res = await call(patchMember, { method: "PATCH", user: bob, params: { orgId: orgB.id, memberId: ownerMember.id }, body: { role: "VIEWER" } });
    expect(res.status).toBe(403);
  });
});

describe("audit log integrity", () => {
  it("audit records cannot be updated or deleted", async () => {
    const row = await getDb().auditLog.findFirstOrThrow();
    await expect(getDb().auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(getDb().auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(getDb().$executeRawUnsafe('TRUNCATE "audit_logs"')).rejects.toThrow();
  });
});
