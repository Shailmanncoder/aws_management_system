import "server-only";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { accountIdFromArn, isRootPrincipalArn } from "./arn";

/**
 * Verifies the platform's own AWS identity at startup (live mode only):
 *  - refuses root credentials outright;
 *  - requires the caller to be the configured PLATFORM_AWS_PRINCIPAL_ARN (exact match for IAM
 *    users; for roles, the assumed-role session of that role).
 * Only the ARN/account are logged — never credentials.
 */
export async function verifyPlatformIdentity(): Promise<void> {
  const env = getEnv();
  if (env.AWS_MODE !== "live") return;
  const sts = new STSClient({ region: env.PLATFORM_AWS_REGION, maxAttempts: 3 });
  try {
    const id = await sts.send(new GetCallerIdentityCommand({}));
    const arn = id.Arn ?? "";
    if (isRootPrincipalArn(arn)) {
      throw new Error("Platform AWS credentials belong to the ROOT user. Refusing to start — use a dedicated IAM user/role.");
    }
    const expected = env.PLATFORM_AWS_PRINCIPAL_ARN;
    const roleMatch = /:role\/(?:.*\/)?([^/]+)$/.exec(expected);
    const ok =
      arn === expected ||
      (roleMatch !== null && accountIdFromArn(arn) === env.PLATFORM_AWS_ACCOUNT_ID && new RegExp(`:assumed-role/${roleMatch[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`).test(arn));
    if (!ok) {
      throw new Error(`Platform AWS identity ${arn} does not match PLATFORM_AWS_PRINCIPAL_ARN.`);
    }
    logger.info("platform AWS identity verified", { principal: arn });
  } finally {
    sts.destroy();
  }
}
