/**
 * Deterministic TEST-ONLY configuration. These values are not secrets: they only exist inside
 * the local/CI test database and the fixture AWS mode.
 */
const testEnv: Record<string, string> = {
  APP_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://stratus:stratus_local_dev_only@127.0.0.1:5432/stratus_test",
  AUTH_SECRET: "test-only-auth-secret-0123456789abcdef0123456789",
  ENCRYPTION_PROVIDER: "local",
  LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AWS_MODE: "fixtures",
  PLATFORM_AWS_ACCOUNT_ID: "111111111111",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111111111111:role/StratusPlatformRole",
  PLATFORM_AWS_REGION: "us-east-1",
  LOG_LEVEL: "error",
  TRUSTED_PROXY_HOPS: "1",
};
for (const [k, v] of Object.entries(testEnv)) process.env[k] = v;
