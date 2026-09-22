import { randomUUID } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple e2e";

/** Isolated browser context with its own client IP (per-IP auth rate limits stay independent). */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  return browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
}

export async function signUp(page: Page, name = "E2E User"): Promise<{ email: string }> {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return { email };
}

export async function createWorkspace(page: Page, name = "E2E Workspace") {
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  // New workspaces land on the Overview (which offers "Connect AWS").
  await expect(page).toHaveURL(/localhost:\d+\/$/);
}

/** Runs the real connection wizard against the fixture AWS world. */
export async function connectAccount(page: Page, awsAccountId = "123456789012", displayName = "Production") {
  await page.goto("/settings/cloud-accounts/connect");
  await page.getByLabel("AWS account ID").fill(awsAccountId);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("External ID", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /created the role/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  // A healthy connection lands on the Overview, which then updates live as the sync runs.
  await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 30_000 });
}

/** Waits until the background worker has finished the first sync for all accounts. */
export async function waitForSync(page: Page) {
  await expect(async () => {
    await page.goto("/settings/cloud-accounts");
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/Queued|Syncing…|Never synced/);
  }).toPass({ timeout: 60_000, intervals: [1000, 2000] });
}
