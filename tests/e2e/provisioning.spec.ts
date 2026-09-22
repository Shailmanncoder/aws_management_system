import { test, expect } from "@playwright/test";
import { createWorkspace, newContext, signUp } from "./helpers";

test("S3 creation requires review and typed confirmation; requests stay in test mocks", async ({
  browser,
}) => {
  const ctx = await newContext(browser),
    page = await ctx.newPage();
  await signUp(page, "Provisioning reviewer");
  await createWorkspace(page, "Provisioning UI");
  let applyCount = 0;
  let planned: Record<string, unknown> = {};
  const accountId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/provisioning/options", (route) =>
    route.fulfill({
      json: {
        network: [],
        guardrails: {
          allowedRegions: ["us-east-1"],
          allowedInstanceTypes: ["t3.micro"],
          maxInstances: 5,
          maxStorageGiB: 100,
          requireEncryption: true,
          allowPublicIpv4: false,
          allowPublicS3: false,
        },
        accounts: [
          {
            id: accountId,
            name: "Test account",
            awsAccountId: "123456789012",
            regions: ["us-east-1"],
            bucketPrefix: "stratus-test-",
          },
        ],
      },
    }),
  );
  await page.route("**/provisioning/plans", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    const { configuration } = route.request().postDataJSON();
    planned = {
      id: "22222222-2222-4222-8222-222222222222",
      status: "PLANNED",
      configurationHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      resourceId: null,
      resultMessage: null,
      review: {
        name: configuration.name,
        service: "s3",
        region: configuration.region,
        configuration,
        tags: { ManagedBy: "Stratus" },
        networkExposure: "Private",
        estimatedMonthlyUsd: null,
        warnings: [
          "Estimated cost unavailable: storage and usage determine charges.",
        ],
        requiredPermissions: ["s3:CreateBucket"],
      },
    };
    await route.fulfill({ json: planned });
  });
  await page.route("**/provisioning/plans/*/apply", async (route) => {
    applyCount++;
    expect(route.request().postDataJSON().confirmation).toBe(
      "stratus-test-reports",
    );
    await route.fulfill({
      json: {
        ...planned,
        status: "SUCCEEDED",
        resourceId: "stratus-test-reports",
        resultMessage:
          "Private encrypted bucket verified. Inventory refreshed.",
      },
    });
  });
  await page.goto("/cloud/s3");
  await page.getByRole("button", { name: "+ Create bucket" }).click();
  await page.getByLabel("Name", { exact: true }).fill("stratus-test-reports");
  await expect(page.getByLabel("Enable versioning")).toBeChecked();
  await page.getByRole("button", { name: "Create review plan" }).click();
  await expect(
    page.getByText("Review deployment", { exact: true }),
  ).toBeVisible();
  expect(applyCount).toBe(0);
  await expect(
    page.getByRole("button", { name: "Confirm and create" }),
  ).toBeDisabled();
  await page
    .getByLabel("Type stratus-test-reports to confirm")
    .fill("stratus-test-reports");
  await page.screenshot({
    path: "test-results/screens/provisioning-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm and create" }).click();
  await expect(
    page.getByText("Private encrypted bucket verified. Inventory refreshed."),
  ).toBeVisible();
  expect(applyCount).toBe(1);
  await ctx.close();
});
