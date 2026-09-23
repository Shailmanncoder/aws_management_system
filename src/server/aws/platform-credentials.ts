import "server-only";
import type { AwsCredentialIdentity } from "@smithy/types";
import { getDb } from "../db";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { decryptSecret, encryptSecret } from "../security/envelope";

/**
 * The platform's own AWS identity — the credentials Stratus uses to call AssumeRole into customer
 * accounts. These are never a customer's credentials.
 *
 * They can come from two places:
 *  - the deployment environment (the default AWS provider chain: instance role, task role, env);
 *  - the database, configured from inside the app, encrypted with the same envelope encryption
 *    used for connection secrets.
 *
 * The database option exists because requiring an operator to edit environment variables and
 * redeploy is a poor way to finish setting up a running deployment, and because setting
 * AWS_MODE=live without credentials used to make the app fail at boot.
 */

const SINGLETON = "singleton";
const ACCESS_KEY_CONTEXT = "platform_credentials:accessKeyId";
const SECRET_CONTEXT = "platform_credentials:secretAccessKey";

/** How long a loaded configuration is trusted before another instance's change is picked up. */
const CACHE_TTL_MS = 30_000;

export interface PlatformIdentity {
  source: "database" | "environment";
  awsAccountId: string;
  principalArn: string;
  region: string;
  verifiedAt: Date | null;
  /** Present only for database-backed credentials; the environment chain resolves its own. */
  credentials?: AwsCredentialIdentity;
}

type CacheState =
  | { kind: "loaded"; identity: PlatformIdentity | null; at: number }
  /** The lookup itself failed, so we do not know whether credentials are configured. */
  | { kind: "unknown"; at: number };

let cache: CacheState | undefined;

/** Drops the cached lookup so the next read goes back to the database. */
export function invalidatePlatformCredentials(): void {
  cache = undefined;
}

/** Test seam: sets the cache directly without touching the database. */
export function setPlatformCredentialsForTests(identity: PlatformIdentity | null | undefined): void {
  cache = identity === undefined ? undefined : { kind: "loaded", identity, at: Date.now() };
}

/**
 * Resolves the platform identity, preferring credentials configured in the app. Returns null when
 * none are configured, in which case the AWS SDK's own provider chain is used.
 */
export async function loadPlatformIdentity(force = false): Promise<PlatformIdentity | null> {
  const now = Date.now();
  if (!force && cache?.kind === "loaded" && now - cache.at < CACHE_TTL_MS) return cache.identity;

  try {
    const row = await getDb().platformCredential.findUnique({ where: { id: SINGLETON } });
    if (!row) {
      // Nothing configured in the app: the SDK's own provider chain applies.
      cache = { kind: "loaded", identity: null, at: now };
      return null;
    }
    const identity: PlatformIdentity = {
      source: "database",
      awsAccountId: row.awsAccountId,
      principalArn: row.principalArn,
      region: row.region,
      verifiedAt: row.verifiedAt,
      credentials: {
        accessKeyId: await decryptSecret(row.accessKeyIdEnc, ACCESS_KEY_CONTEXT),
        secretAccessKey: await decryptSecret(row.secretAccessKeyEnc, SECRET_CONTEXT),
      },
    };
    cache = { kind: "loaded", identity, at: now };
    return identity;
  } catch (err) {
    // Never log the row; only that the lookup failed.
    logger.error("platform credential lookup failed", { err });
    cache = { kind: "unknown", at: now };
    return null;
  }
}

/** Metadata only — never the secret. Safe to send to a browser. */
export async function describePlatformIdentity(): Promise<{
  configured: boolean;
  source: PlatformIdentity["source"];
  awsAccountId: string | null;
  principalArn: string | null;
  region: string | null;
  verifiedAt: string | null;
}> {
  const identity = await loadPlatformIdentity();
  const env = getEnv();
  if (!identity) {
    return {
      configured: false,
      source: "environment",
      awsAccountId: env.PLATFORM_AWS_ACCOUNT_ID,
      principalArn: env.PLATFORM_AWS_PRINCIPAL_ARN,
      region: env.PLATFORM_AWS_REGION,
      verifiedAt: null,
    };
  }
  return {
    configured: true,
    source: identity.source,
    awsAccountId: identity.awsAccountId,
    principalArn: identity.principalArn,
    region: identity.region,
    verifiedAt: identity.verifiedAt?.toISOString() ?? null,
  };
}

/**
 * The mode AWS calls actually run in.
 *
 * Fixture mode is only ever active when the deployment asked for it AND no real platform
 * credentials have been configured. If the credential lookup failed we deliberately report "live":
 * attempting a real call that fails loudly is far better than silently serving synthetic data as
 * though it were the customer's own.
 */
export function awsMode(): "live" | "fixtures" {
  if (getEnv().AWS_MODE !== "fixtures") return "live";
  if (cache?.kind === "loaded") return cache.identity ? "live" : "fixtures";
  if (cache?.kind === "unknown") return "live";
  // Not primed yet: fall back to the configured mode.
  return "fixtures";
}

/** Credentials for the platform STS client, or undefined to use the SDK's own provider chain. */
export async function platformCredentials(): Promise<AwsCredentialIdentity | undefined> {
  return (await loadPlatformIdentity())?.credentials;
}

/** Region for platform calls: the configured one wins over the environment default. */
export async function platformRegion(): Promise<string> {
  return (await loadPlatformIdentity())?.region ?? getEnv().PLATFORM_AWS_REGION;
}

export async function storePlatformCredentials(input: {
  accessKeyId: string;
  secretAccessKey: string;
  awsAccountId: string;
  principalArn: string;
  region: string;
  configuredById: string;
}): Promise<void> {
  const [accessKeyIdEnc, secretAccessKeyEnc] = await Promise.all([
    encryptSecret(input.accessKeyId, ACCESS_KEY_CONTEXT),
    encryptSecret(input.secretAccessKey, SECRET_CONTEXT),
  ]);
  const data = {
    accessKeyIdEnc,
    secretAccessKeyEnc,
    awsAccountId: input.awsAccountId,
    principalArn: input.principalArn,
    region: input.region,
    verifiedAt: new Date(),
    configuredById: input.configuredById,
  };
  await getDb().platformCredential.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
  invalidatePlatformCredentials();
}

export async function removePlatformCredentials(): Promise<void> {
  await getDb().platformCredential.deleteMany({ where: { id: SINGLETON } });
  invalidatePlatformCredentials();
}
