import { expect, test } from "@playwright/test";
import { connectAccount, createWorkspace, newContext, signUp, waitForSync } from "./helpers";

test("operations: evidence, saved views, ownership, incidents and reviewed requests", async ({ browser }) => {
  const ctx = await newContext(browser), page = await ctx.newPage();
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await signUp(page, "Operations Owner"); await createWorkspace(page, "Operations Browser Test");
  await connectAccount(page); await waitForSync(page);
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await page.getByLabel("Describe the resources you need").fill("running production servers without an owner");
  await expect(page.getByRole("link", { name: "Open filtered inventory" })).toHaveAttribute("href", /unowned=true/);
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const views = page.locator("section").filter({ has: page.getByRole("heading", { name: "Workspace saved views" }) });
  await views.getByLabel("Name", { exact: true }).fill("Team servers");
  await views.getByLabel("Inventory URL").fill("/resources?type=ec2%3Ainstance&state=running");
  await views.getByLabel("Share with workspace").check();
  await views.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Team servers · Shared" })).toBeVisible();
  await page.getByRole("link", { name: "Team servers · Shared" }).click();
  await expect(page.getByRole("link", { name: "Team servers · Shared" })).toBeVisible();
  await page.goto("/operations?tab=Resources");
  const ownership = page.locator("section").filter({ has: page.getByRole("heading", { name: "Resource ownership", exact: true }) });
  await ownership.getByLabel("Name", { exact: true }).fill("Website responsibility");
  await ownership.getByLabel("Owner", { exact: true }).fill("Website team");
  await ownership.getByLabel("Team", { exact: true }).fill("Engineering");
  await ownership.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ownership.getByText(/Website responsibility: Website team/)).toBeVisible();
  const drift = page.locator("section").filter({ has: page.getByRole("heading", { name: "Configuration drift", exact: true }) });
  await drift.getByLabel("Name", { exact: true }).fill("Approved configuration");
  await drift.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drift.getByText("Approved configuration: Matches baseline")).toBeVisible();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const incident = page.locator("section").filter({ has: page.getByRole("heading", { name: "Incident workspace", exact: true }) });
  await incident.getByLabel("Name", { exact: true }).fill("Investigate website");
  await incident.getByLabel("Initial note").fill("Review recent changes");
  await incident.getByLabel("Follow-up task").fill("Check monitoring");
  await incident.getByRole("button", { name: "Save", exact: true }).click();
  await expect(incident.getByRole("heading", { name: "Investigate website · OPEN" })).toBeVisible();
  await incident.getByLabel("Investigation note").fill("Monitoring reviewed");
  await incident.getByLabel("Check monitoring").check();
  await incident.getByLabel("Incident status").selectOption("RESOLVED");
  await incident.getByRole("button", { name: "Update incident" }).click();
  await expect(incident.getByRole("heading", { name: "Investigate website · RESOLVED" })).toBeVisible();
  for (const tab of ["Overview", "Resources", "Reliability", "Costs", "Team", "Automation", "Templates", "Notifications"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator("main")).not.toContainText("An unexpected error");
  }
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "test-results/screens/operations-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["Overview", "Resources", "Reliability", "Costs", "Team", "Automation", "Templates", "Notifications"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/screens/operations-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  await ctx.close();
});
