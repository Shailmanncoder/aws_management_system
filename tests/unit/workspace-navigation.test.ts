import { describe, it, expect } from "vitest";
import { workspaceDestination } from "@/lib/workspace-navigation";
describe("workspace navigation", () => {
  it("drops entity IDs and connection forms while retaining the section", () => {
    expect(workspaceDestination("/cloud/ec2/old-resource")).toBe("/cloud/ec2");
    expect(workspaceDestination("/settings/cloud-accounts/connect")).toBe("/settings/cloud-accounts");
    expect(workspaceDestination("/security/old-finding")).toBe("/security");
    expect(workspaceDestination("/budget")).toBe("/budget");
    expect(workspaceDestination("/unknown")).toBe("/");
  });
});
