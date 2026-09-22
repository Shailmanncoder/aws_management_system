import { expect, test } from "@playwright/test";
import { createWorkspace, newContext, signUp } from "./helpers";

test.describe("security controls (browser level)", () => {
  test("security headers and CSP on pages; locked-down CSP on APIs", async ({ request }) => {
    const page = await request.get("/sign-in");
    const h = page.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
    const api = await request.get("/api/v1/orgs/00000000-0000-4000-8000-000000000000/members");
    expect(api.status()).toBe(401);
    expect(api.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(api.headers()["cache-control"]).toContain("no-store");
    const body = await api.text();
    expect(body).not.toMatch(/stack|prisma|\/Users\//i);
  });

  test("unauthenticated pages redirect to sign-in without open redirects", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto("/cloud/ec2");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcloud%2Fec2/);
    await signUp(page, "Redirect Tester");
    await createWorkspace(page, "Redirect WS");
    // Signed-in users visiting auth pages land on the Overview.
    await page.goto("/sign-in?next=https://evil.example");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await ctx.close();
  });

  test("cross-origin state-changing requests are rejected (CSRF)", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await signUp(page, "Csrf Tester");
    const res = await page.request.post("/api/v1/orgs", { data: { name: "Evil" }, headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_REJECTED");
    const form = await page.request.post("/api/v1/orgs", { form: { name: "Form" }, headers: { origin: "http://localhost:3100" } });
    expect(form.status()).toBe(400);
    await ctx.close();
  });

  test("session cookie is httpOnly and SameSite=Lax; secrets never reach the browser", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await signUp(page, "Cookie Tester");
    const cookie = (await ctx.cookies()).find((c) => c.name.endsWith("session_token"));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toMatch(/AKIA|ASIA|SecretAccessKey|SessionToken|externalId/i);
    await ctx.close();
  });
});
