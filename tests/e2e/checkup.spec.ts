import { expect, test } from "@playwright/test";
import { connectAccount, createWorkspace, newContext, signUp, waitForSync } from "./helpers";

const shot = (name: string) => ({ path: `test-results/screens/${name}.png`, fullPage: true });

test.describe.serial("account check-up", () => {
  test("explains what is missing in plain language and links to the fix", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();

    await signUp(page, "Sam Checkup");
    await createWorkspace(page, "Checkup Workspace");

    // Before connecting anything, the first thing it asks for is an account.
    await page.goto("/checkup");
    await expect(page.getByRole("heading", { name: "Account check-up" })).toBeVisible();
    await expect(page.getByText("No cloud account is connected yet")).toBeVisible();
    // It must not claim safety it has not verified.
    await expect(page.getByText(/not finished looking inside your account/)).toBeVisible();
    await page.screenshot(shot("30-checkup-empty"));

    await connectAccount(page, "123456789012", "Production");
    await waitForSync(page);

    await page.goto("/checkup");
    await expect(page.getByText("Some of your files can be opened by anyone")).toBeVisible();
    await expect(page.getByText("Your machines are open to the whole internet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Do this now" })).toBeVisible();

    const body = await page.locator("main").innerText();
    // Plain language only: no rule codes or severity words on this page.
    expect(body).not.toMatch(/S3-PUBLIC|SG-OPEN|CRITICAL|AccessDenied/);
    await page.screenshot(shot("31-checkup-findings"));

    // Each problem leads to the step-by-step fix.
    await page.getByRole("link", { name: /Show me exactly where to click/ }).first().click();
    await expect(page.getByText(/How to check it worked/)).toBeVisible();

    await ctx.close();
  });
});
