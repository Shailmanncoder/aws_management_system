import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverNotifications } from "@/server/services/notification-service";
const mocks = vi.hoisted(() => ({ db: vi.fn(), auth: vi.fn(), mail: vi.fn(), close: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: mocks.db }));
vi.mock("@/server/env", () => ({ getEnv: () => ({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.test", SMTP_PORT: 587, MAIL_FROM: "stratus@example.test", APP_URL: "https://stratus.example.test" }) }));
vi.mock("@/server/authz/guard", () => ({ assertCan: () => {}, authorizeOrg: mocks.auth }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.mail, close: mocks.close }) } }));
const memberId = "00000000-0000-4000-8000-000000000001";
function setup(attempts = 0) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    notificationDelivery: {
      findMany: vi.fn(async () => [{ id: "delivery", organizationId: "org", subscriptionId: "sub", eventId: "alert", attempts }]),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { count: 1 }; }),
    },
    workspaceRecord: { findFirst: vi.fn(async () => ({ organizationId: "org", userId: "creator", name: "Team alerts", payload: { memberId, enabled: true } })) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: "member@example.test", emailVerified: true })) },
  };
  mocks.db.mockReturnValue(db); mocks.auth.mockResolvedValue({}); mocks.mail.mockResolvedValue({});
  return { db, updates };
}
beforeEach(() => vi.clearAllMocks());
describe("notification delivery", () => {
  it("rechecks both memberships and sends a generic link without alert details", async () => {
    const { updates } = setup(); await deliverNotifications();
    expect(mocks.auth).toHaveBeenCalledWith("creator", "org", "alerts:manage");
    expect(mocks.auth).toHaveBeenCalledWith(memberId, "org", "alerts:read");
    expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ to: { address: "member@example.test", name: "" }, text: expect.stringContaining("https://stratus.example.test/alerts") }));
    expect(updates.at(-1)?.status).toBe("SENT"); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("does not send after permissions are revoked", async () => {
    const { updates } = setup(); mocks.auth.mockRejectedValue(new Error("Revoked"));
    await deliverNotifications(); expect(mocks.mail).not.toHaveBeenCalled(); expect(updates.at(-1)?.status).toBe("PENDING");
  });
  it("bounds retries and records delivery failures", async () => {
    const { updates } = setup(2); mocks.mail.mockRejectedValue(new Error("SMTP unavailable"));
    await deliverNotifications(); expect(updates.at(-1)?.status).toBe("FAILED"); expect(mocks.close).toHaveBeenCalledOnce();
  });
});
