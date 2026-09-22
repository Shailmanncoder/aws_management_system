import { expect, test } from "@playwright/test";
import { connectAccount, createWorkspace, newContext, signUp, waitForSync } from "./helpers";

const shot = (name: string) => ({ path: `test-results/screens/${name}.png`, fullPage: true });

test.describe.serial("core journey: signup → workspace → connect AWS → inventory → cost", () => {
  test("end-to-end", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await signUp(page, "Jordan Admin");
    await createWorkspace(page, "Acme Cloud Platform");
    await connectAccount(page, "123456789012", "Production");
    // Live updates: the top bar reports sync progress without a manual reload.
    await expect(page.getByRole("status").filter({ hasText: /Syncing|Live/ })).toBeVisible({ timeout: 20_000 });
    await page.screenshot(shot("01-connected"));
    await connectAccount(page, "210987654321", "Staging");
    await waitForSync(page);
    await page.screenshot(shot("02-cloud-accounts"));

    // Dashboard
    await page.goto("/");
    await expect(page.getByText("EC2 instances").first()).toBeVisible();
    await expect(page.getByText("Current month spend")).toBeVisible();
    await page.screenshot(shot("03-dashboard"));

    // EC2 list + filter by state via the real URL filter
    await page.goto("/cloud/ec2");
    await expect(page.getByRole("link", { name: "web-1" })).toBeVisible();
    await page.goto("/cloud/ec2?state=stopped");
    await expect(page.getByRole("link", { name: "batch-worker" })).toBeVisible();
    await expect(page.getByRole("link", { name: "web-1" })).toHaveCount(0);
    await page.goto("/cloud/ec2");
    // Per-page refresh: queues a sync, the button shows progress, and the page updates by itself.
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await refresh.click();
    await expect(page.getByText(/Sync started|already running/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "web-1" })).toBeVisible();
    await page.screenshot(shot("04-ec2"));

    // XSS: the fixture tag value `<img onerror>` must render as inert text.
    await page.goto("/cloud/ec2?q=bastion");
    await expect(page.getByText(/note=<img src=x onerror/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    // EC2 detail with CloudWatch graphs
    await page.getByRole("link", { name: "bastion" }).click();
    await page.getByRole("tab", { name: "Monitoring" }).click();
    await expect(page.getByText("CPU utilization").first()).toBeVisible();
    await page.screenshot(shot("05-ec2-detail-monitoring"));
    await page.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByText(/Internet/).first()).toBeVisible();

    // S3 posture
    await page.goto("/cloud/s3");
    const row = page.getByRole("row", { name: /acme-public-website/ });
    await expect(row.getByText("Public", { exact: true })).toBeVisible();
    await page.screenshot(shot("06-s3"));
    await page.getByRole("link", { name: "acme-public-website" }).click();
    await expect(page.getByText(/AWS evaluates the bucket policy as public/)).toBeVisible();

    // Network topology
    await page.goto("/cloud/network");
    await expect(page.getByText("prod-vpc")).toBeVisible();
    await page.screenshot(shot("07-network"));

    // Cost explorer
    await page.goto("/cost?range=3m");
    await expect(page.getByRole("button", { name: "Refresh cost data" })).toBeVisible();
    await expect(page.getByText("Current month to date")).toBeVisible();
    await expect(page.getByText("Daily spend")).toBeVisible();
    await page.screenshot(shot("08-cost"));

    // Security findings from the real post-sync analyzer.
    await page.goto("/security?severity=CRITICAL");
    await expect(page.getByRole("heading", { name: "Security Center" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "S3 bucket acme-public-website is publicly accessible" })).toBeVisible();
    await page.getByText("Evidence and remediation", { exact: true }).first().click();
    await expect(page.getByText("Investigate or remediate:", { exact: true }).first()).toBeVisible();
    await page.screenshot(shot("09-security"));
    const findingTitle = await page.locator("article").first().getByRole("heading").innerText();
    await page.getByLabel("Reason for accepting this risk").first().fill("Accepted temporarily for browser verification");
    await page.getByRole("button", { name: "Suppress finding", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: findingTitle, exact: true })).toHaveCount(0);
    await page.goto("/security?status=SUPPRESSED");
    await expect(page.getByRole("heading", { name: findingTitle, exact: true })).toBeVisible();
    await page.getByText("Evidence and remediation", { exact: true }).first().click();
    await page.getByLabel("Reason for reopening").fill("Reopen after browser verification");
    await page.getByRole("button", { name: "Reopen finding", exact: true }).click();
    await expect(page.getByRole("heading", { name: findingTitle, exact: true })).toHaveCount(0);
    await page.goto("/security?severity=CRITICAL");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/security.*\.csv$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot(shot("10-security-mobile"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Security Center
    await page.goto("/security");
    await expect(page.getByText(/acme-public-website is publicly accessible/).first()).toBeVisible();
    await page.screenshot(shot("09-security"));

    // Optimization
    await page.goto("/optimization");
    await expect(page.getByText(/Unattached EBS volume/).first()).toBeVisible();
    await expect(page.getByText("Estimated monthly savings")).toBeVisible();
    await page.screenshot(shot("10-optimization"));

    // Alerts, audit, monitoring
    await page.goto("/settings/alerts");
    await expect(page.getByText("New public exposure")).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByText("aws.connected").first()).toBeVisible();
    await page.screenshot(shot("11-audit"));
    await page.goto("/monitoring");
    await expect(page.getByText("Average CPU (14 days)")).toBeVisible();

    // Global search (⌘K)
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/Name, instance ID/).fill("198.51.100.10");
    await expect(page.getByRole("option", { name: /web-1/ })).toBeVisible();
    await page.getByRole("option", { name: /web-1/ }).click();
    await expect(page).toHaveURL(/\/cloud\/ec2\//);

    expect(errors.filter((e) => /Content Security Policy|Refused to/.test(e))).toEqual([]);
    await ctx.close();
  });
});
