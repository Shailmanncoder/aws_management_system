import { describe, expect, it } from "vitest";
import { evaluateOptimization, type OptimizationInput } from "@/server/rules/optimization-rules";
import type { PriceBook } from "@/server/aws/pricing";

const now = new Date("2026-09-22T00:00:00Z");
const noPrices: PriceBook = { available: false, ebsGbMonth: () => null, snapshotGbMonth: () => null, instanceHourly: () => null, publicIpv4Hourly: () => null };
const prices: PriceBook = { available: true, ebsGbMonth: (_r, t) => ({ gp2: 0.1, gp3: 0.08 })[t] ?? null, snapshotGbMonth: () => 0.05, instanceHourly: () => 0.1, publicIpv4Hourly: () => 0.005 };
const res = (resourceType: string, resourceId: string, attributes: unknown, state: string | null = null, tags: Record<string, string> = { env: "p", team: "t" }) => ({ id: `id-${resourceId}`, resourceType, region: "us-east-1", resourceId, name: null, attributes, state, tags });
const input = (resources: OptimizationInput["resources"], p = prices, cpu = new Map()): OptimizationInput => ({ resources, cpu, prices: p, requiredTagKeys: ["env", "team"], now });

describe("optimization rules", () => {
  it("unattached volume: estimated savings only when a real price exists", () => {
    const vol = res("ec2:volume", "vol-1", { sizeGiB: 100, volumeType: "gp3", encrypted: true, availabilityZone: null, attachedInstanceIds: [], createTime: "2026-01-01T00:00:00Z" }, "available");
    const [withPrice] = evaluateOptimization(input([vol]));
    expect(withPrice).toMatchObject({ ruleId: "EBS-UNATTACHED", dataBasis: "ESTIMATED", estimatedMonthlySavings: 8 });
    const [noPrice] = evaluateOptimization(input([vol], noPrices));
    expect(noPrice).toMatchObject({ dataBasis: "CONFIRMED", estimatedMonthlySavings: null });
  });

  it("gp2 → gp3 savings are the per-GiB price difference", () => {
    const vol = res("ec2:volume", "vol-2", { sizeGiB: 500, volumeType: "gp2", encrypted: true, availabilityZone: null, attachedInstanceIds: ["i-1"], createTime: null }, "in-use");
    const f = evaluateOptimization(input([vol])).find((d) => d.ruleId === "EBS-GP2-TO-GP3")!;
    expect(f.estimatedMonthlySavings).toBe(10);
  });

  it("rightsizing requires ≥10 days of CPU data and never claims savings without a price", () => {
    const inst = res("ec2:instance", "i-9", { instanceType: "m6i.large", volumeIds: [] }, "running");
    expect(evaluateOptimization(input([inst], prices, new Map([["i-9", { avg: 1, max: 3, datapoints: 5 }]])))).toHaveLength(0);
    const [idle] = evaluateOptimization(input([inst], prices, new Map([["i-9", { avg: 1, max: 3, datapoints: 14 }]])));
    expect(idle).toMatchObject({ ruleId: "EC2-IDLE", dataBasis: "ESTIMATED", estimatedMonthlySavings: 36.5 });
    const [under] = evaluateOptimization(input([inst], noPrices, new Map([["i-9", { avg: 3, max: 15, datapoints: 14 }]])));
    expect(under).toMatchObject({ ruleId: "EC2-UNDERUTILIZED", dataBasis: "HEURISTIC", estimatedMonthlySavings: null });
    expect(evaluateOptimization(input([inst], prices, new Map([["i-9", { avg: 40, max: 90, datapoints: 14 }]])))).toHaveLength(0);
  });

  it("old snapshots are heuristic with an upper-bound note", () => {
    const snap = res("ec2:snapshot", "snap-1", { volumeId: "v", sizeGiB: 100, startTime: "2025-01-01T00:00:00Z", encrypted: true });
    const [f] = evaluateOptimization(input([snap]));
    expect(f).toMatchObject({ ruleId: "SNAPSHOT-OLD", dataBasis: "HEURISTIC", confidence: "LOW" });
    expect(f!.limitations).toMatch(/upper bound/);
  });

  it("flags missing required tags as confirmed governance findings", () => {
    const b = res("s3:bucket", "b1", { lifecycleRuleCount: { ok: true, value: 2 }, versioning: { ok: true, value: "Enabled" } }, null, { env: "prod" });
    const [f] = evaluateOptimization(input([b]));
    expect(f).toMatchObject({ ruleId: "TAGS-MISSING", dataBasis: "CONFIRMED", evidence: { missing: ["team"] } });
  });
});
