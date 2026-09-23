import "server-only";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { z } from "zod";
import { accountIdFromArn, isRootPrincipalArn } from "../aws/arn";
import { classifyAwsError } from "../aws/errors";
import {
  describePlatformIdentity,
  removePlatformCredentials,
  storePlatformCredentials,
} from "../aws/platform-credentials";
import { assertKnownRegion } from "../aws/regions-catalog";
import type { OrgAccess } from "../authz/guard";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { logger } from "../logging/logger";
import { AUDIT, recordAudit } from "./audit-service";

/**
 * Lets an operator finish setting up a running deployment from inside the app, instead of editing
 * environment variables and redeploying.
 *
 * These are the PLATFORM's credentials, shared by every workspace on the deployment, so this is
 * gated twice: the operator must opt in with ALLOW_IN_APP_PLATFORM_SETUP, and the caller must be a
 * workspace Owner. The opt-in is off by default because on a multi-tenant deployment one
 * customer's Owner must never be able to change credentials that every other customer depends on;
 * there they have to come from the deployment environment.
 */

export const platformCredentialsInput = z.strictObject({
  accessKeyId: z
    .string()
    .trim()
    .regex(/^(AKIA|ASIA)[A-Z0-9]{16}$/, "That does not look like an AWS access key ID."),
  secretAccessKey: z.string().trim().min(16).max(256),
  region: z.string().trim().min(3).max(30),
});

export type PlatformCredentialsInput = z.infer<typeof platformCredentialsInput>;

async function assertPlatformAdmin(access: OrgAccess): Promise<void> {
  if (!getEnv().ALLOW_IN_APP_PLATFORM_SETUP) {
    throw new AppError(
      "FORBIDDEN",
      "This deployment does not allow platform credentials to be set from the app. An operator must set them in the deployment environment.",
    );
  }
  if (access.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only a workspace Owner can change the platform's AWS credentials.");
  }
}

/** Metadata about the current platform identity. Never includes the secret. */
export async function getPlatformSetup(access: OrgAccess) {
  await assertPlatformAdmin(access);
  return describePlatformIdentity();
}

/**
 * Verifies the supplied credentials against AWS and stores them encrypted.
 *
 * The account id and principal ARN are taken from AWS's own answer rather than from the form, so
 * a typo cannot bind the deployment to the wrong identity. Root credentials are refused outright.
 */
export async function savePlatformCredentials(access: OrgAccess, raw: unknown) {
  await assertPlatformAdmin(access);
  const input = platformCredentialsInput.parse(raw);
  assertKnownRegion(input.region);

  const sts = new STSClient({
    region: input.region,
    maxAttempts: 2,
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
  });

  let arn: string;
  let awsAccountId: string;
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    arn = identity.Arn ?? "";
    awsAccountId = identity.Account ?? "";
  } catch (err) {
    // The AWS message can echo the key id, so it is classified rather than repeated.
    logger.warn("platform credential verification failed", { class: classifyAwsError(err) });
    await recordAudit({
      action: AUDIT.PLATFORM_CREDENTIALS_REJECTED,
      organizationId: access.organizationId,
      actorUserId: access.userId,
      targetType: "platform",
      targetId: "singleton",
      outcome: "FAILURE",
      metadata: { reason: classifyAwsError(err) },
    });
    throw new AppError(
      "VALIDATION_FAILED",
      classifyAwsError(err) === "invalid_credentials"
        ? "AWS rejected those credentials. Check the access key and secret, and that the key is still active."
        : "AWS could not be reached to verify those credentials. Try again shortly.",
    );
  } finally {
    sts.destroy();
  }

  if (!arn || !/^\d{12}$/.test(awsAccountId)) {
    throw new AppError("VALIDATION_FAILED", "AWS did not return a usable identity for those credentials.");
  }
  if (isRootPrincipalArn(arn)) {
    await recordAudit({
      action: AUDIT.PLATFORM_CREDENTIALS_REJECTED,
      organizationId: access.organizationId,
      actorUserId: access.userId,
      targetType: "platform",
      targetId: "singleton",
      outcome: "FAILURE",
      metadata: { reason: "root_credentials" },
    });
    throw new AppError(
      "VALIDATION_FAILED",
      "Those are root user credentials. Root keys cannot be limited or rotated safely — create a dedicated IAM user with read-only access and use its key instead.",
    );
  }
  if (accountIdFromArn(arn) !== awsAccountId) {
    throw new AppError("VALIDATION_FAILED", "The AWS identity is inconsistent. Please re-check the credentials.");
  }

  await storePlatformCredentials({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    awsAccountId,
    principalArn: arn,
    region: input.region,
    configuredById: access.userId,
  });

  await recordAudit({
    action: AUDIT.PLATFORM_CREDENTIALS_SET,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    targetType: "platform",
    targetId: "singleton",
    outcome: "SUCCESS",
    // The principal and account are not secret; the key never appears here.
    metadata: { principalArn: arn, awsAccountId, region: input.region },
  });

  return describePlatformIdentity();
}

export async function clearPlatformCredentials(access: OrgAccess) {
  await assertPlatformAdmin(access);
  await removePlatformCredentials();
  await recordAudit({
    action: AUDIT.PLATFORM_CREDENTIALS_CLEARED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    targetType: "platform",
    targetId: "singleton",
    outcome: "SUCCESS",
  });
  return describePlatformIdentity();
}
