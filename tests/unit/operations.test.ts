import { describe, expect, it } from "vitest";
import { changedFields, interpretInventorySearch, operationInput, recordInput, stableJson } from "@/lib/operations";
import { backupReadiness, costSpikes, relatedResources, type OpsResource, type OpsCost } from "@/lib/operations-insights";
const resource = (id: string, attrs: Record<string, unknown> = {}, extra: Partial<OpsResource> = {}): OpsResource => ({ id, resourceId: id, resourceType: "ec2:instance", name: id, state: "running", region: "us-east-1", awsAccountRefId: "a", attributes: attrs, tags: [], lastSeenAt: "2026-09-23T00:00:00Z", awsAccount: { displayName: "A", lastSyncedAt: "2026-09-23T00:00:00Z", syncStatus: "SUCCEEDED" }, ...extra });
describe("operations evidence", () => {
  it("ignores object ordering but detects nested configuration changes", () => {
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(changedFields({ tags: { env: "prod" }, attributes: { public: false } }, { attributes: { public: true }, tags: { env: "prod" } })).toEqual(["attributes"]);
  });
  it("derives only exact dependencies in the same account and region", () => {
    const vm = resource("i-a", { vpcId: "vpc-a" });
    expect(relatedResources(vm, [vm, resource("vpc-a"), resource("vpc-ab"), resource("vpc-a", {}, { id: "foreign", awsAccountRefId: "b" }), resource("vpc-a", {}, { id: "other-region", region: "us-west-2" })]).map(r => r.id)).toEqual(["vpc-a"]);
  });
  it("distinguishes configured backups, missing evidence, and old snapshots", () => {
    const volume = resource("vol-a", {}, { resourceType: "ec2:volume" });
    expect(backupReadiness(volume, []).status).toBe("Unknown");
    expect(backupReadiness(volume, [resource("snap-a", { volumeId: "vol-a", startTime: "2026-09-01" }, { resourceType: "ec2:snapshot", state: "completed" })], Date.parse("2026-09-24")).status).toBe("Review");
    expect(backupReadiness(resource("db", { backupRetentionDays: 7 }, { resourceType: "rds:db-instance" }), []).status).toBe("Configured");
  });
  it("translates supported language into reviewable filters without silently executing", () => {
    expect(interpretInventorySearch("show running production servers without an owner in us-east-1").filters).toEqual({ type: "ec2:instance", state: "running", tag: "env=production", unowned: "true", region: "us-east-1" });
    expect(interpretInventorySearch("delete everything").supported).toBe(false);
  });
  it("uses the latest reported day when today is absent and requires seven consecutive days", () => {
    const rows: OpsCost[] = Array.from({ length: 8 }, (_, i) => ({ awsAccountRefId: "a", dimension: "TOTAL", dimensionKey: "", periodStart: `2026-09-${String(23 - i).padStart(2, "0")}T00:00:00Z`, unit: "USD", amount: i === 0 ? 30 : 10, estimated: false }));
    expect(costSpikes(rows, new Date("2026-09-24"))[0]?.amount).toBe(30);
    expect(costSpikes(rows.filter((_, i) => i !== 3), new Date("2026-09-24"))).toEqual([]);
    expect(costSpikes(rows.map((r, i) => ({ ...r, unit: i % 2 ? "INR" : "USD" })), new Date("2026-09-24"))).toEqual([]);
  });
  it("rejects unsafe saved paths and duplicate or invalid operation inputs", () => {
    expect(recordInput.safeParse({ kind: "VIEW", name: "unsafe", shared: true, payload: { path: "javascript:alert(1)", query: "" } }).success).toBe(false);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(operationInput.safeParse({ name: "stop", resourceIds: [id, id], action: "stop" }).success).toBe(false);
    expect(operationInput.safeParse({ name: "tags", resourceIds: [id], action: "tag", tags: [{ key: "aws:reserved", value: "x" }] }).success).toBe(false);
    expect(operationInput.safeParse({ name: "stop", resourceIds: [id], action: "stop", timezone: "not-a-timezone" }).success).toBe(false);
  });
});
