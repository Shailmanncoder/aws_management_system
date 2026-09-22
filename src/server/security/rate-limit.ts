import "server-only";
import { getDb } from "../db";
import { AppError } from "../errors";
import { logger } from "../logging/logger";

/**
 * Server-side fixed-window rate limiting backed by PostgreSQL, so limits hold across all app
 * instances. A single atomic UPSERT per check. Fails CLOSED if the store is unavailable.
 */

export interface RateLimitPolicy {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_POLICIES = {
  /** Generic authenticated API usage per user. */
  api: { limit: 300, windowSeconds: 60 },
  /** Org/workspace creation per user. */
  orgCreate: { limit: 10, windowSeconds: 3600 },
  /** Member invitations per org. */
  invite: { limit: 30, windowSeconds: 3600 },
  /** AWS connection start/validation per org (each validation calls STS + diagnostics). */
  connectionValidate: { limit: 20, windowSeconds: 3600 },
  /** Manual inventory refresh per AWS account (refresh buttons on every page). */
  manualSync: { limit: 20, windowSeconds: 3600 },
  /** Manual Cost Explorer refresh per AWS account (each CE request is billed by AWS). */
  manualCostSync: { limit: 6, windowSeconds: 3600 },
  /** Report exports per user. */
  export: { limit: 30, windowSeconds: 3600 },
  /** Live Cost Explorer queries per org (each CE request is billed by AWS). */
  costQuery: { limit: 60, windowSeconds: 3600 },
  /** On-demand CloudWatch metric reads per org. */
  metricsQuery: { limit: 240, windowSeconds: 3600 },
  /** Operational AWS actions per org. */
  awsAction: { limit: 10, windowSeconds: 3600 },
  /** Global search per user. */
  search: { limit: 120, windowSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  policyName: RateLimitPolicyName,
  subject: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const policy: RateLimitPolicy = RATE_LIMIT_POLICIES[policyName];
  const windowMs = policy.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const key = `${policyName}:${subject}`;

  let count: number;
  try {
    const rows = await getDb().$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limit_buckets" ("key", "windowStart", "count", "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1
      RETURNING "count"`;
    count = Number(rows[0]?.count ?? Number.MAX_SAFE_INTEGER);
  } catch (err) {
    logger.error("rate limit store unavailable", { policy: policyName, err });
    throw new AppError("SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please retry.", { cause: err });
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
  return { allowed: count <= policy.limit, remaining: Math.max(0, policy.limit - count), retryAfterSeconds };
}

/** Throws RATE_LIMITED when exceeded. */
export async function enforceRateLimit(policyName: RateLimitPolicyName, subject: string): Promise<void> {
  const res = await checkRateLimit(policyName, subject);
  if (!res.allowed) {
    logger.warn("rate limit exceeded", { policy: policyName });
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait before trying again.", {
      retryAfterSeconds: res.retryAfterSeconds,
    });
  }
}

/** Housekeeping (worker): drop expired buckets. */
export async function purgeExpiredRateLimitBuckets(): Promise<number> {
  const res = await getDb().rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}
