import "server-only";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { accountIdFromArn, isRootPrincipalArn } from "./arn";
import { classifyAwsError } from "./errors";
import { awsMode, loadPlatformIdentity } from "./platform-credentials";

/**
 * Verifies the platform's own AWS identity at startup (live mode only):
 *  - refuses root credentials outright;
 *  - requires the caller to be the configured platform principal (exact match for IAM users;
 *    for roles, the assumed-role session of that role).
 * Only the ARN/account are logged — never credentials.
 *
 * A WRONG identity still refuses to start: running with root or a mismatched principal is a
 * confused-deputy risk, and that check is not negotiable. A MISSING identity does not, because a
 * deployment that has not been set up yet should come up and ask for credentials rather than
 * crash-loop — the UI reports it and every AWS call fails with a clear message until it is fixed.
 */
export type PlatformIdentityStatus = "verified" | "not-configured" | "skipped";

export async function verifyPlatformIdentity(): Promise<PlatformIdentityStatus> {
  const env = getEnv();
  const configured = await loadPlatformIdentity();
  if (awsMode() !== "live") return "skipped";
  const sts = new STSClient({
    region: configured?.region ?? env.PLATFORM_AWS_REGION,
    maxAttempts: 3,
    ...(configured?.credentials ? { credentials: configured.credentials } : {}),
  });
  try {
    const id = await sts.send(new GetCallerIdentityCommand({}));
    const arn = id.Arn ?? "";
    if (isRootPrincipalArn(arn)) {
      throw new Error("Platform AWS credentials belong to the ROOT user. Refusing to start — use a dedicated IAM user/role.");
    }
    const expected = configured?.principalArn ?? env.PLATFORM_AWS_PRINCIPAL_ARN;
    const roleMatch = /:role\/(?:.*\/)?([^/]+)$/.exec(expected);
    const ok =
      arn === expected ||
      (roleMatch !== null && accountIdFromArn(arn) === (configured?.awsAccountId ?? env.PLATFORM_AWS_ACCOUNT_ID) && new RegExp(`:assumed-role/${roleMatch[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`).test(arn));
    if (!ok) {
      throw new Error(`Platform AWS identity ${arn} does not match PLATFORM_AWS_PRINCIPAL_ARN.`);
    }
    logger.info("platform AWS identity verified", { principal: arn, source: configured ? "database" : "environment" });
    return "verified";
  } catch (err) {
    // Credentials that cannot be resolved at all mean "not set up yet", not "misconfigured".
    const cls = classifyAwsError(err);
    if (!(err instanceof Error && err.message.startsWith("Platform AWS")) && (cls === "invalid_credentials" || cls === "expired")) {
      logger.warn("platform AWS credentials are not configured; AWS features are unavailable until they are set in Settings");
      return "not-configured";
    }
    throw err;
  } finally {
    sts.destroy();
  }
}
