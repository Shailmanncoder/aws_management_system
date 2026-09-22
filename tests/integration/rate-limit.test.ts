import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as createOrg } from "@/app/api/v1/orgs/route";
import { checkRateLimit, RATE_LIMIT_POLICIES } from "@/server/security/rate-limit";
import { call, createUser } from "../helpers/app";

describe("rate limiting", () => {
  it("allows up to the limit then blocks within the window", async () => {
    const subject = `test:${randomUUID()}`;
    const limit = RATE_LIMIT_POLICIES.manualSync.limit;
    const now = new Date();
    for (let i = 0; i < limit; i++) expect((await checkRateLimit("manualSync", subject, now)).allowed).toBe(true);
    const blocked = await checkRateLimit("manualSync", subject, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("is atomic under concurrency", async () => {
    const subject = `test:${randomUUID()}`;
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 30 }, () => checkRateLimit("manualSync", subject, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(RATE_LIMIT_POLICIES.manualSync.limit);
  });

  it("returns 429 with Retry-After through the API", async () => {
    const user = await createUser("ratelimited");
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT_POLICIES.orgCreate.limit + 1; i++) {
      statuses.push((await call(createOrg, { user, body: { name: `Org ${i}` } })).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 201)).toBe(true);
    const last = await call(createOrg, { user, body: { name: "one more" } });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("isolates subjects (one user's limit doesn't affect another)", async () => {
    const now = new Date();
    const a = `test:${randomUUID()}`;
    for (let i = 0; i < 7; i++) await checkRateLimit("manualSync", a, now);
    expect((await checkRateLimit("manualSync", `test:${randomUUID()}`, now)).allowed).toBe(true);
  });
});
