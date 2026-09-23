import { describe, expect, it } from "vitest";
import { budgetProgress, weekWindow } from "@/lib/simple";
describe("budget clarity", () => {
  it("does not present unavailable spending as zero or safe", () => {
    expect(budgetProgress(null, 100, null)).toEqual({ percent: null, remaining: null, status: "Waiting for spending data" });
    expect(budgetProgress(Number.NaN, 100, null).percent).toBeNull();
  });
  it("distinguishes actual overspend from a projection", () => {
    expect(budgetProgress(60, 100, 120).status).toBe("May exceed your budget");
    expect(budgetProgress(110, 100, 95)).toMatchObject({ remaining: -10, status: "Over budget" });
    expect(budgetProgress(0, 100, 0).status).toBe("Within your budget so far");
  });
});
describe("weekly summary windows", () => {
  it("uses completed Monday-to-Monday UTC weeks across month and year boundaries", () => {
    const w = weekWindow(new Date("2026-01-01T09:00:00Z"));
    expect(w.start.toISOString()).toBe("2025-12-22T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });
  it("does not include future days in the current week", () => {
    const now = new Date("2026-09-23T09:15:00Z"), w = weekWindow(now,0);
    expect(w.start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(w.end).toEqual(now);
  });
});
