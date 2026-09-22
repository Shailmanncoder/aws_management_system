import { describe, expect, it } from "vitest";
import { envSchema } from "@/server/env";

const base = { ...process.env };

describe("environment validation", () => {
  it("accepts the test configuration", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it("rejects fixture mode and local keys in production", () => {
    const res = envSchema.safeParse({ ...base, APP_ENV: "production", APP_URL: "https://app.example.com" });
    expect(res.success).toBe(false);
    const paths = res.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("AWS_MODE");
    expect(paths).toContain("ENCRYPTION_PROVIDER");
  });

  it("rejects http APP_URL in production", () => {
    const res = envSchema.safeParse({ ...base, APP_ENV: "production", AWS_MODE: "live", ENCRYPTION_PROVIDER: "kms", KMS_KEY_ID: "k", KMS_REGION: "us-east-1" });
    expect(res.error?.issues.map((i) => i.path[0])).toContain("APP_URL");
  });

  it("rejects a principal ARN from another account", () => {
    const res = envSchema.safeParse({ ...base, PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::222222222222:role/X" });
    expect(res.success).toBe(false);
  });

  it("rejects short auth secrets and malformed master keys", () => {
    expect(envSchema.safeParse({ ...base, AUTH_SECRET: "short" }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, LOCAL_MASTER_KEY: "abc" }).success).toBe(false);
  });

  it("error messages never include values", () => {
    const res = envSchema.safeParse({ ...base, AUTH_SECRET: "tiny-secret-value" });
    expect(JSON.stringify(res.error?.issues)).not.toContain("tiny-secret-value");
  });
});
