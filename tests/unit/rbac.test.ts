import { describe, expect, it } from "vitest";
import { canAssignRole, hasPermission, PERMISSIONS, ROLES } from "@/lib/rbac";

describe("RBAC matrix", () => {
  it("owner has every permission", () => {
    for (const p of PERMISSIONS) expect(hasPermission("OWNER", p)).toBe(true);
  });

  it("only owners can delete orgs or configure actions", () => {
    for (const r of ROLES.filter((r) => r !== "OWNER")) {
      expect(hasPermission(r, "org:delete")).toBe(false);
      expect(hasPermission(r, "actions:configure")).toBe(false);
    }
  });

  it("viewer is read-only", () => {
    const writes = ["members:invite", "members:manage", "aws_accounts:connect", "aws_accounts:disconnect", "sync:trigger", "alerts:manage", "actions:request", "org:update", "reports:export"] as const;
    for (const p of writes) expect(hasPermission("VIEWER", p)).toBe(false);
    expect(hasPermission("VIEWER", "inventory:read")).toBe(true);
  });

  it("billing viewer sees cost but not inventory/security", () => {
    expect(hasPermission("BILLING_VIEWER", "cost:read")).toBe(true);
    expect(hasPermission("BILLING_VIEWER", "inventory:read")).toBe(false);
    expect(hasPermission("BILLING_VIEWER", "security:read")).toBe(false);
  });

  it("security viewer sees security + audit but not cost", () => {
    expect(hasPermission("SECURITY_VIEWER", "security:read")).toBe(true);
    expect(hasPermission("SECURITY_VIEWER", "audit:read")).toBe(true);
    expect(hasPermission("SECURITY_VIEWER", "cost:read")).toBe(false);
  });

  it("operator can sync but not connect accounts or manage members", () => {
    expect(hasPermission("OPERATOR", "sync:trigger")).toBe(true);
    expect(hasPermission("OPERATOR", "aws_accounts:connect")).toBe(false);
    expect(hasPermission("OPERATOR", "members:manage")).toBe(false);
  });

  it("prevents privilege escalation through role assignment", () => {
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "OPERATOR")).toBe(true);
    expect(canAssignRole("ADMIN", "VIEWER", "OWNER")).toBe(false); // cannot demote an owner
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(canAssignRole("OPERATOR", "VIEWER")).toBe(false);
    expect(canAssignRole("VIEWER", "VIEWER")).toBe(false);
  });
});
