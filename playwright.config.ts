import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the PRODUCTION build + the real worker against an isolated database in
 * AWS fixture mode (no real AWS credentials required). Values below are test-only.
 */
const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://stratus:stratus_local_dev_only@127.0.0.1:5432/stratus_e2e";

const env: Record<string, string> = {
  APP_ENV: "test",
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: E2E_DB,
  AUTH_SECRET: "e2e-only-auth-secret-0123456789abcdef0123456789",
  ENCRYPTION_PROVIDER: "local",
  LOCAL_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"),
  AWS_MODE: "fixtures",
  PLATFORM_AWS_ACCOUNT_ID: "111111111111",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111111111111:role/StratusPlatformRole",
  PLATFORM_AWS_REGION: "us-east-1",
  TRUSTED_PROXY_HOPS: "1",
  LOG_LEVEL: "warn",
  SCHEDULED_SYNC_INTERVAL_MINUTES: "0",
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    url: `http://localhost:${PORT}/sign-in`,
    env: { ...env, E2E_PORT: String(PORT) },
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
