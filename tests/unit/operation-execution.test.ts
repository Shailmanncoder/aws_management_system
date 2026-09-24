import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resourceSnapshot, stableJson } from "@/lib/operations";
import { executeOperation } from "@/server/services/operation-plan-service";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), authorize: vi.fn(), owned: vi.fn(), audit: vi.fn(), assume: vi.fn(), client: vi.fn(), send: vi.fn(), dispose: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/authz/guard", () => ({ assertCan: () => {}, authorizeOrg: mocks.authorize }));
vi.mock("@/server/services/operations-service", () => ({ ownedResource: mocks.owned, operationsAudit: mocks.audit, jsonValue: (v: unknown) => JSON.parse(JSON.stringify(v)) }));
vi.mock("@/server/aws/platform-credentials", () => ({ awsMode: () => "live" }));
vi.mock("@/server/security/envelope", () => ({ decryptSecret: async () => "external-id" }));
vi.mock("@/server/services/aws-session-service", () => ({ externalIdContext: () => "context" }));
vi.mock("@/server/aws/sts", () => ({ assumeRoleSession: mocks.assume, buildSessionName: () => "test-session" }));
vi.mock("@/server/aws/client-factory", () => ({ createAwsClient: mocks.client }));
const id = "00000000-0000-4000-8000-000000000001";
const a = { organizationId: "org", userId: "requester", role: "OWNER" as const, can: () => true };
const resource = { id, resourceId: "i-test", resourceType: "ec2:instance", region: "us-east-1", awsAccountRefId: "account", name: "Server", state: "running", attributes: {}, tags: [] };
const hash = (r: typeof resource) => createHash("sha256").update(stableJson(resourceSnapshot(r))).digest("hex");
function setup() {
  const plan = { id: "plan", organizationId: "org", userId: "requester", approvedBy: "approver", status: "APPROVED", scheduledAt: null, expiresAt: new Date(Date.now() + 3600000), payload: { name: "Stop", resourceIds: [id], action: "stop", tags: [], timezone: "UTC", snapshots: [{ id, hash: hash(resource) }] } };
  const updates: Record<string, unknown>[] = [];
  const db = {
    operationPlan: { findFirst: vi.fn(async () => plan), updateMany: vi.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => { if (where.status && plan.status !== where.status) return { count: 0 }; if (typeof data.status === "string") plan.status = data.status; updates.push(data); return { count: 1 }; }) },
    organization: { findUniqueOrThrow: vi.fn(async () => ({ actionModeEnabled: true })) },
    awsConnection: { findFirst: vi.fn(async () => ({ actionRoleArn: "arn:aws:iam::123456789012:role/Actions", roleArn: "arn:aws:iam::123456789012:role/ReadOnly", method: "ASSUME_ROLE", status: "CONNECTED", externalIdEnc: "encrypted", awsAccountRefId: "account", awsAccount: { awsAccountId: "123456789012", partition: "aws" } })) },
  };
  mocks.getDb.mockReturnValue(db); mocks.owned.mockResolvedValue(resource); mocks.authorize.mockResolvedValue(a);
  mocks.assume.mockResolvedValue({ dispose: mocks.dispose }); mocks.client.mockReturnValue({ send: mocks.send, destroy: vi.fn() });
  mocks.send.mockImplementation(async (cmd) => cmd.constructor.name === "DescribeInstancesCommand" ? { Reservations: [{ Instances: [{ State: { Name: "running" } }] }] } : {});
  return { plan, updates, db };
}
beforeEach(() => { vi.clearAllMocks(); });
describe("reviewed operation execution", () => {
  it("uses the separate action role, rechecks AWS state, persists receipts and prevents replay", async () => {
    const { plan } = setup();
    await executeOperation(a, "plan");
    expect(mocks.assume).toHaveBeenCalledWith(expect.objectContaining({ roleArn: "arn:aws:iam::123456789012:role/Actions", expectedAccountId: "123456789012" }));
    expect(mocks.send.mock.calls.map(([cmd]) => cmd.constructor.name)).toEqual(["DescribeInstancesCommand", "StopInstancesCommand"]);
    expect(mocks.dispose).toHaveBeenCalledOnce(); expect(plan.status).toBe("SUCCEEDED");
    await expect(executeOperation(a, "plan")).rejects.toThrow(/expired or already ran/);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it("blocks execution after permission revocation or reviewed inventory drift", async () => {
    setup(); mocks.authorize.mockRejectedValueOnce(new Error("Revoked"));
    await expect(executeOperation(a, "plan")).rejects.toThrow("Revoked"); expect(mocks.assume).not.toHaveBeenCalled();
    setup(); mocks.owned.mockResolvedValue({ ...resource, attributes: { instanceType: "changed" } });
    await expect(executeOperation(a, "plan")).rejects.toThrow(/Inventory changed/); expect(mocks.assume).not.toHaveBeenCalled();
  });
  it("does not issue a write when AWS reports a different state", async () => {
    const { plan } = setup(); mocks.send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] });
    await executeOperation(a, "plan"); expect(mocks.send).toHaveBeenCalledOnce(); expect(plan.status).toBe("CHECK_REQUIRED");
  });
  it("records uncertain AWS failures for inspection and does not retry the plan", async () => {
    const { plan } = setup(); mocks.send.mockRejectedValue(new Error("Connection lost"));
    await executeOperation(a, "plan"); expect(plan.status).toBe("CHECK_REQUIRED"); expect(mocks.dispose).toHaveBeenCalledOnce();
    await expect(executeOperation(a, "plan")).rejects.toThrow(); expect(mocks.send).toHaveBeenCalledOnce();
  });
});
