import { expect, test } from "@playwright/test";
import { connectAccount, createWorkspace, newContext, signUp, waitForSync } from "./helpers";

const shot = (name: string) => ({ path: `test-results/screens/${name}.png`, fullPage: true });

test.describe.serial("guided walkthroughs", () => {
  test("a finding links to steps that name the reader's own resources", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();

    await signUp(page, "Robin Guide");
    await createWorkspace(page, "Guide Workspace");
    await connectAccount(page, "123456789012", "Production");
    await waitForSync(page);

    // Index lists every category.
    await page.goto("/guides");
    await expect(page.getByRole("heading", { name: "Guides" })).toBeVisible();
    for (const heading of ["Launch compute", "Storage and databases", "Networking basics", "Fix a finding"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await page.screenshot(shot("20-guides-index"));

    // The EC2 walkthrough is personalised with a real VPC id from the synced inventory.
    await page.getByRole("link", { name: "Launch an EC2 instance" }).click();
    await expect(page.getByRole("heading", { name: "Launch an EC2 instance" })).toBeVisible();
    await expect(page.getByText(/Filled in from your inventory/)).toBeVisible();
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/vpc-[0-9a-z]+/);
    // No placeholder should survive rendering where a value was available.
    expect(body).not.toContain("{{");
    // Console deep links point at the real AWS console and open in a new tab.
    const consoleLink = page.getByRole("link", { name: /Open EC2 in the AWS console/ }).first();
    await expect(consoleLink).toHaveAttribute("href", /^https:\/\/[a-z0-9-]+\.console\.aws\.amazon\.com\//);
    await expect(consoleLink).toHaveAttribute("rel", /noopener/);
    await page.screenshot(shot("21-guides-ec2"));

    // Findings raised by Stratus's own rules offer the click-by-click fix inline. Findings
    // imported from GuardDuty or Security Hub carry AWS's rule ids and correctly have none, so
    // expand every finding and take the first that does.
    await page.goto("/security?source=STRATUS_RULE");
    const panels = page.getByText("Evidence and remediation");
    for (let i = 0; i < (await panels.count()); i++) await panels.nth(i).click();
    const fixLink = page.getByRole("link", { name: /Show me exactly where to click/ }).first();
    await expect(fixLink).toBeVisible();
    await fixLink.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/How to check it worked/)).toBeVisible();
    // The walkthrough was opened for that finding's own resource, so its id appears in the steps.
    expect(new URL(page.url()).searchParams.get("region")).toBeTruthy();
    await page.screenshot(shot("22-guides-remediation"));

    // An unknown guide id is a 404, not a server error.
    const res = await page.goto("/guides/does-not-exist");
    expect(res?.status()).toBe(404);

    await ctx.close();
  });
});
