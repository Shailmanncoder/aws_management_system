import "server-only";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { accountIdFromArn, isRootPrincipalArn } from "./arn";
import { createAwsClient, createPlatformClient } from "./client-factory";
import { awsErrorCode, classifyAwsError } from "./errors";
import { globalRegionFor } from "./regions-catalog";
import { AwsSession } from "./session";

export class AssumeRoleError extends Error {
  constructor(
    readonly reason: "denied" | "throttled" | "platform_misconfigured" | "unavailable",
    cause: unknown,
  ) {
    super(`AssumeRole failed: ${reason}`, { cause });
    this.name = "AssumeRoleError";
  }
}

export interface AssumeRoleParams {
  roleArn: string;
  externalId: string;
  /** Correlates CloudTrail entries in the customer account with Stratus operations. */
  sessionName: string;
  partition: string;
  expectedAccountId: string;
  durationSeconds?: number;
}

/** Session names appear in the customer's CloudTrail; restrict to AWS's charset and 64 chars. */
export function buildSessionName(purpose: string, id: string): string {
  return `stratus-${purpose}-${id}`.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}

async function callAssumeRole(p: AssumeRoleParams): Promise<AwsCredentialIdentity> {
  const sts = createPlatformClient(STSClient, getEnv().PLATFORM_AWS_REGION, "sts");
  try {
    const res = await sts.send(
      new AssumeRoleCommand({
        RoleArn: p.roleArn,
        RoleSessionName: p.sessionName,
        ExternalId: p.externalId,
        DurationSeconds: p.durationSeconds ?? 3600,
      }),
    );
    const c = res.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new AssumeRoleError("unavailable", new Error("empty credentials"));
    // The assumed-role ARN must be in the expected account (defence against substitution).
    const assumedAccount = res.AssumedRoleUser?.Arn ? accountIdFromArn(res.AssumedRoleUser.Arn) : null;
    if (assumedAccount && assumedAccount !== p.expectedAccountId) {
      throw new AssumeRoleError("denied", new Error("assumed role account mismatch"));
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration,
    };
  } catch (err) {
    if (err instanceof AssumeRoleError) throw err;
    const cls = classifyAwsError(err);
    // Log only the error class/code — never the request parameters (ExternalId).
    logger.warn("sts:AssumeRole failed", { errorCode: awsErrorCode(err), errorClass: cls });
    if (cls === "access_denied" || cls === "not_found" || cls === "validation") throw new AssumeRoleError("denied", err);
    if (cls === "throttled") throw new AssumeRoleError("throttled", err);
    if (cls === "invalid_credentials" || cls === "expired") throw new AssumeRoleError("platform_misconfigured", err);
    throw new AssumeRoleError("unavailable", err);
  } finally {
    sts.destroy();
  }
}

/**
 * Assumes the customer's cross-account role. The returned session re-assumes automatically
 * before expiry for long jobs. Nothing here is persisted.
 */
export async function assumeRoleSession(p: AssumeRoleParams): Promise<AwsSession> {
  const credentials = await callAssumeRole(p);
  return new AwsSession({
    accountId: p.expectedAccountId,
    partition: p.partition,
    kind: getEnv().AWS_MODE === "fixtures" ? "fixture" : "assumed-role",
    sessionName: p.sessionName,
    credentials,
    refresh: () => callAssumeRole(p),
  });
}

/** Access-key session (development/explicitly permitted deployments only). */
export function accessKeySession(p: {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  partition: string;
}): AwsSession {
  return new AwsSession({
    accountId: p.accountId,
    partition: p.partition,
    kind: getEnv().AWS_MODE === "fixtures" ? "fixture" : "access-key",
    sessionName: "stratus-access-key",
    credentials: { accessKeyId: p.accessKeyId, secretAccessKey: p.secretAccessKey },
  });
}

export interface CallerIdentity {
  account: string;
  arn: string;
  isRoot: boolean;
}

export async function getCallerIdentity(session: AwsSession): Promise<CallerIdentity> {
  const sts = createAwsClient(STSClient, session, globalRegionFor(session.partition), "sts");
  try {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    const arn = res.Arn ?? "";
    return { account: res.Account ?? "", arn, isRoot: isRootPrincipalArn(arn) };
  } finally {
    sts.destroy();
  }
}
