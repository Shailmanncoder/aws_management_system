import "server-only";
import { z } from "zod";

/**
 * Environment validation. Parsed lazily on first access (so `next build` does not require runtime
 * secrets) and eagerly at process start via `instrumentation.ts` / the worker entry point.
 * Security-sensitive combinations are rejected for production.
 */

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const intString = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const awsAccountId = z.string().regex(/^\d{12}$/, "must be a 12-digit AWS account ID");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "test", "production"]),
    APP_URL: z.url(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection string"),

    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    AUTH_GITHUB_CLIENT_ID: optionalString,
    AUTH_GITHUB_CLIENT_SECRET: optionalString,
    AUTH_GOOGLE_CLIENT_ID: optionalString,
    AUTH_GOOGLE_CLIENT_SECRET: optionalString,
    AUTH_LINKEDIN_CLIENT_ID: optionalString,
    AUTH_LINKEDIN_CLIENT_SECRET: optionalString,
    AUTH_REQUIRE_EMAIL_VERIFICATION: booleanString,
    MAIL_TRANSPORT: z.enum(["disabled", "smtp", "test"]).default("disabled"),
    MAIL_FROM: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: intString(587, 1, 65535),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,

    ENCRYPTION_PROVIDER: z.enum(["local", "kms"]).default("local"),
    LOCAL_MASTER_KEY: optionalString,
    KMS_KEY_ID: optionalString,
    KMS_REGION: optionalString,

    AWS_MODE: z.enum(["live", "fixtures"]).default("live"),
    PLATFORM_AWS_ACCOUNT_ID: awsAccountId,
    PLATFORM_AWS_PRINCIPAL_ARN: z
      .string()
      .regex(
        /^arn:aws(-[a-z]+)*:iam::\d{12}:(role|user)\/[\w+=,.@\/-]{1,512}$/,
        "must be an IAM role or user ARN",
      ),
    PLATFORM_AWS_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/).default("us-east-1"),
    ALLOW_ACCESS_KEY_CONNECTIONS: booleanString,
    /**
     * Single-account self-hosting: allow connecting the platform's OWN AWS account. Off by
     * default; forbidden when APP_ENV=production (multi-tenant confused-deputy protection).
     */
    ALLOW_PLATFORM_ACCOUNT_CONNECTION: booleanString,
    /**
     * Allows the platform's own AWS credentials to be set from inside the app by a workspace
     * Owner, instead of only from this environment. Off by default: on a multi-tenant deployment
     * one customer's Owner must never be able to change credentials shared by every customer.
     * Intended for single-tenant / self-hosted installations.
     */
    ALLOW_IN_APP_PLATFORM_SETUP: booleanString,

    WORKER_CONCURRENCY: intString(2, 1, 32),
    WORKER_POLL_INTERVAL_MS: intString(3000, 250, 60000),
    AWS_REGION_CONCURRENCY: intString(4, 1, 16),
    AWS_SERVICE_CONCURRENCY: intString(3, 1, 16),
    SCHEDULED_SYNC_INTERVAL_MINUTES: intString(360, 0, 10080),
    /** Optional liveness endpoint for the worker (container health checks). 0 = disabled. */
    WORKER_HEALTH_PORT: intString(0, 0, 65535),

    /** Number of trusted reverse proxies in front of the app (ALB = 1). 0 = ignore X-Forwarded-For. */
    TRUSTED_PROXY_HOPS: intString(1, 0, 5),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (env.ENCRYPTION_PROVIDER === "local") {
      const raw = env.LOCAL_MASTER_KEY ? Buffer.from(env.LOCAL_MASTER_KEY, "base64") : null;
      if (!raw || raw.length !== 32) {
        issue("LOCAL_MASTER_KEY", "must be 32 random bytes, base64-encoded");
      }
    }
    if (env.ENCRYPTION_PROVIDER === "kms" && (!env.KMS_KEY_ID || !env.KMS_REGION)) {
      issue("KMS_KEY_ID", "KMS_KEY_ID and KMS_REGION are required when ENCRYPTION_PROVIDER=kms");
    }
    const principalAccount = env.PLATFORM_AWS_PRINCIPAL_ARN.split(":")[4];
    if (principalAccount !== env.PLATFORM_AWS_ACCOUNT_ID) {
      issue("PLATFORM_AWS_PRINCIPAL_ARN", "must belong to PLATFORM_AWS_ACCOUNT_ID");
    }
    if ((env.AUTH_GITHUB_CLIENT_ID === undefined) !== (env.AUTH_GITHUB_CLIENT_SECRET === undefined)) {
      issue("AUTH_GITHUB_CLIENT_ID", "GitHub OAuth requires both client id and secret");
    }
    if ((env.AUTH_GOOGLE_CLIENT_ID === undefined) !== (env.AUTH_GOOGLE_CLIENT_SECRET === undefined)) {
      issue("AUTH_GOOGLE_CLIENT_ID", "Google OAuth requires both client id and secret");
    }
    if ((env.AUTH_LINKEDIN_CLIENT_ID === undefined) !== (env.AUTH_LINKEDIN_CLIENT_SECRET === undefined)) {
      issue("AUTH_LINKEDIN_CLIENT_ID", "LinkedIn OAuth requires both client id and secret");
    }

    if (env.MAIL_TRANSPORT === "smtp") {
      if (!env.SMTP_HOST || !env.MAIL_FROM) issue("SMTP_HOST", "SMTP_HOST and MAIL_FROM are required for email delivery");
      if (env.MAIL_FROM && !z.email().safeParse(env.MAIL_FROM).success) issue("MAIL_FROM", "must be a valid sender email address");
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) issue("SMTP_USER", "SMTP_USER and SMTP_PASSWORD must be set together");
    }
    if (env.MAIL_TRANSPORT === "test" && env.APP_ENV !== "test") issue("MAIL_TRANSPORT", "test mail capture is allowed only in tests");
    if (env.AUTH_REQUIRE_EMAIL_VERIFICATION && env.MAIL_TRANSPORT === "disabled") issue("MAIL_TRANSPORT", "email verification requires an email transport");
    if (env.APP_ENV === "production") {
      if (env.MAIL_TRANSPORT !== "smtp") issue("MAIL_TRANSPORT", "production requires configured SMTP for account recovery");
      if (!env.AUTH_REQUIRE_EMAIL_VERIFICATION) issue("AUTH_REQUIRE_EMAIL_VERIFICATION", "production requires verified email addresses");
      try { const url = new URL(env.DATABASE_URL); if (!["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) issue("DATABASE_URL", "production requires TLS (sslmode=verify-full recommended)"); } catch { issue("DATABASE_URL", "invalid database URL"); }
      if (env.ENCRYPTION_PROVIDER !== "kms") {
        issue("ENCRYPTION_PROVIDER", "production requires ENCRYPTION_PROVIDER=kms");
      }
      if (env.ALLOW_PLATFORM_ACCOUNT_CONNECTION) {
        issue("ALLOW_PLATFORM_ACCOUNT_CONNECTION", "must be false in production");
      }
      if (env.AWS_MODE !== "live") {
        issue("AWS_MODE", "fixture mode is forbidden in production");
      }
      if (!env.APP_URL.startsWith("https://")) {
        issue("APP_URL", "production requires an https:// APP_URL");
      }
      if (/replace-me|changeme|example/i.test(env.AUTH_SECRET)) {
        issue("AUTH_SECRET", "placeholder secret detected");
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Returns validated env. Throws a message listing only variable NAMES (never values). */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clears the memoised env so tests can vary process.env. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}

export const isProduction = () => getEnv().APP_ENV === "production";
