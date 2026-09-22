import { describe, expect, it } from "vitest";
import { fillDays, percentChange, projectMonthEnd, resolveRange, topNWithOther } from "@/lib/cost-math";

describe("cost math", () => {
  it("percent change handles zero baselines honestly", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(5, 0)).toBeNull();
  });

  it("refuses to project from fewer than 3 complete days", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(projectMonthEnd(100, 2, now)).toBeNull();
    expect(projectMonthEnd(300, 3, now)).toBeCloseTo(3000); // 30-day month
  });

  it("folds the tail into Other", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ key: `s${i}`, amount: 12 - i }));
    const out = topNWithOther(rows, 8);
    expect(out).toHaveLength(9);
    expect(out.at(-1)).toEqual({ key: "Other", amount: 4 + 3 + 2 + 1 });
  });

  it("leaves gaps as null instead of fabricating zeros", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-03T00:00:00Z");
    const out = fillDays([{ day: "2026-09-02", amount: 5, estimated: false }], start, end);
    expect(out.map((d) => d.amount)).toEqual([null, 5, null]);
  });

  it("clamps custom ranges to today and resolves presets inclusively", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const r = resolveRange("7d", now);
    expect(r.start.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(r.end.toISOString().slice(0, 10)).toBe("2026-09-22");
    expect(resolveRange("custom", now, { from: "2026-09-01", to: "2027-01-01" }).end.toISOString().slice(0, 10)).toBe("2026-09-22");
  });
});
