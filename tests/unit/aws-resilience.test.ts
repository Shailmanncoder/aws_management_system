import { describe, expect, it, vi } from "vitest";
import { mapSettledLimit } from "@/server/aws/concurrency";
import { classifyAwsError } from "@/server/aws/errors";
import { paginate, PaginationLimitError } from "@/server/aws/paginate";
import { backoffDelay, withRetry } from "@/server/aws/retry";

const awsErr = (name: string, status?: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe("classifyAwsError", () => {
  it.each([
    ["Throttling", "throttled"],
    ["RequestLimitExceeded", "throttled"],
    ["TooManyRequestsException", "throttled"],
    ["AccessDenied", "access_denied"],
    ["UnauthorizedOperation", "access_denied"],
    ["InvalidAccessException", "not_enabled"],
    ["OptInRequired", "region_unavailable"],
    ["ExpiredToken", "expired"],
    ["NoSuchBucket", "not_found"],
    ["InternalFailure", "unknown"],
  ])("%s → %s", (name, cls) => expect(classifyAwsError(awsErr(name))).toBe(cls));

  it("uses HTTP status as fallback", () => {
    expect(classifyAwsError(awsErr("Weird", 429))).toBe("throttled");
    expect(classifyAwsError(awsErr("Weird", 503))).toBe("service_unavailable");
  });
});

describe("withRetry", () => {
  it("retries throttling with full-jitter exponential backoff", async () => {
    const sleeps: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(awsErr("Throttling")).mockRejectedValueOnce(awsErr("ThrottlingException")).mockResolvedValue("ok");
    const res = await withRetry(fn, { sleep: async (ms) => void sleeps.push(ms), random: () => 0.999, baseDelayMs: 100, maxDelayMs: 10_000 });
    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([99, 199]);
  });

  it("does not retry non-retryable errors (e.g. AccessDenied)", async () => {
    const fn = vi.fn().mockRejectedValue(awsErr("AccessDenied"));
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow("AccessDenied");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(awsErr("Throttling"));
    await expect(withRetry(fn, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("caps the backoff delay", () => {
    expect(backoffDelay(20, 500, 20_000, () => 0.9999)).toBeLessThan(20_000);
  });
});

describe("mapSettledLimit", () => {
  it("never exceeds the concurrency bound and isolates failures", async () => {
    let active = 0;
    let peak = 0;
    const res = await mapSettledLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      if (i === 7) throw new Error("region failed");
      return i * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(res[7]!.status).toBe("rejected");
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(19);
    expect((res[3] as PromiseFulfilledResult<number>).value).toBe(6);
  });
});

describe("paginate", () => {
  it("follows tokens until exhausted (never assumes one page)", async () => {
    const pages: Record<string, { items: number[]; next?: string }> = { "": { items: [1, 2], next: "a" }, a: { items: [3], next: "b" }, b: { items: [4] } };
    const out = await paginate(async (t) => pages[t ?? ""]!, (p) => ({ items: p.items, nextToken: p.next }));
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it("detects token loops", async () => {
    await expect(paginate(async () => ({ items: [1], next: "same" }), (p) => ({ items: p.items, nextToken: p.next }))).rejects.toBeInstanceOf(PaginationLimitError);
  });

  it("enforces page and item caps", async () => {
    let n = 0;
    await expect(paginate(async () => ({ items: [1], next: String(n++) }), (p) => ({ items: p.items, nextToken: p.next }), { maxPages: 5 })).rejects.toThrow(/page limit/);
    await expect(paginate(async () => ({ items: Array(10).fill(0) as number[], next: undefined }), (p) => ({ items: p.items, nextToken: p.next }), { maxItems: 5 })).rejects.toThrow(/item limit/);
  });
});
