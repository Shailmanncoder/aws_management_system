import { test, expect, type Page } from "@playwright/test";
import { newContext, signUp, createWorkspace, connectAccount, waitForSync } from "./helpers";
import { NAV_SECTIONS } from "../../src/components/layout/nav-items";

async function switchTo(page: Page, name: string) {
  await page.getByRole("button", { name: /^Workspace:/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
  await expect(page.getByRole("button", { name: `Workspace: ${name}`, exact: true })).toBeVisible();
}
async function saveBudget(page: Page, amount: string) {
  await page.goto("/budget");
  await page.getByLabel("Monthly budget", { exact: true }).filter({ visible: true }).fill(amount);
  await page.getByRole("button", { name: "Save monthly budget" }).click();
  await expect(page.getByText("Monthly budget saved").filter({ visible: true })).toBeVisible();
}

test("workspace changes reset every section, forms, account filters and other browser tabs", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await newContext(browser), page = await context.newPage();
  await signUp(page);
  await createWorkspace(page, "North Studio");
  await connectAccount(page, "123456789012", "North account");
  await waitForSync(page);
  await saveBudget(page, "1234");
  await page.goto("/onboarding");
  await createWorkspace(page, "South Studio");
  await saveBudget(page, "5678");
  await switchTo(page, "North Studio");
  await expect(page.getByLabel("Monthly budget", { exact: true })).toHaveValue("1234");
  // An unsaved draft must not survive the change and target the old workspace.
  await page.getByLabel("Monthly budget", { exact: true }).fill("9999");
  const other = await context.newPage();
  await other.goto("/budget?currency=USD&region=us-east-1");
  await expect(other.getByLabel("Monthly budget", { exact: true })).toHaveValue("1234");
  await switchTo(page, "South Studio");
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.getByLabel("Monthly budget", { exact: true })).toHaveValue("5678");
  await expect(other.getByRole("button", { name: "Workspace: South Studio", exact: true })).toBeVisible();
  await expect(other).toHaveURL(/\/budget$/);
  await expect(other.getByLabel("Monthly budget", { exact: true })).toHaveValue("5678");
  for (const path of NAV_SECTIONS.flatMap(s => s.items.map(i => i.href))) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("button", { name: "Workspace: South Studio", exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("North account");
    await expect(page.getByRole("combobox", { name: "AWS account scope" })).toHaveCount(0);
  }
  await saveBudget(page, "6789");
  // Private browser policies may reject persistent storage; the channel fallback still syncs tabs.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); }; });
  await switchTo(page, "North Studio");
  await expect(page.getByLabel("Monthly budget", { exact: true })).toHaveValue("1234");
  await expect(other.getByRole("button", { name: "Workspace: North Studio", exact: true })).toBeVisible();
  await page.goto("/settings/cloud-accounts");
  await expect(page.locator("main")).toContainText("North account");
  await context.close();
});
