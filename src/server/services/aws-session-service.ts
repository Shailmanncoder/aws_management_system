import "server-only";
import { AppError, notFound } from "../errors";
import { accessKeySession, assumeRoleSession, AssumeRoleError, buildSessionName } from "../aws/sts";
import type { AwsSession } from "../aws/session";
import { effectiveRegions } from "../aws/regions";
import { findSecretsForSession } from "../repositories/aws-account-repository";
import { decryptSecret } from "../security/envelope";

/** Encryption contexts bind each ciphertext to its tenant + account row. */
export const externalIdContext = (organizationId: string, accountRefId: string) =>
  `aws_connection:${organizationId}:${accountRefId}:externalId`;
export const accessKeyContext = (organizationId: string, accountRefId: string, part: "id" | "secret") =>
  `aws_connection:${organizationId}:${accountRefId}:accessKey:${part}`;

export interface OpenedSession {
  session: AwsSession;
  regions: string[];
  awsAccountId: string;
}

/**
 * Opens a short-lived AWS session for a connected account. Secrets are decrypted in memory,
 * handed to the STS call / session object and not retained anywhere else. Callers MUST call
 * `session.dispose()` when done (use `withAwsSession`).
 */
export async function openAwsSession(organizationId: string, accountRefId: string, purpose: string): Promise<OpenedSession> {
  const conn = await findSecretsForSession(organizationId, accountRefId);
  if (!conn) throw notFound("AWS account");
  if (conn.status === "DISCONNECTED" || conn.status === "PENDING") {
    throw new AppError("PRECONDITION_FAILED", "The AWS account is not connected.");
  }
  const { awsAccountId, partition } = conn.awsAccount;
  let session: AwsSession;
  if (conn.method === "ACCESS_KEY") {
    if (!conn.accessKeyIdEnc || !conn.secretAccessKeyEnc) throw new AppError("PRECONDITION_FAILED", "Access-key credentials are missing.");
    session = accessKeySession({
      accessKeyId: await decryptSecret(conn.accessKeyIdEnc, accessKeyContext(organizationId, accountRefId, "id")),
      secretAccessKey: await decryptSecret(conn.secretAccessKeyEnc, accessKeyContext(organizationId, accountRefId, "secret")),
      accountId: awsAccountId,
      partition,
    });
  } else {
    if (!conn.roleArn) throw new AppError("PRECONDITION_FAILED", "No role ARN is configured.");
    try {
      session = await assumeRoleSession({
        roleArn: conn.roleArn,
        externalId: await decryptSecret(conn.externalIdEnc, externalIdContext(organizationId, accountRefId)),
        sessionName: buildSessionName(purpose, conn.id.slice(0, 8)),
        partition,
        expectedAccountId: awsAccountId,
      });
    } catch (err) {
      if (err instanceof AssumeRoleError) {
        if (err.reason === "throttled") throw new AppError("AWS_THROTTLED", "AWS API request was throttled. Retrying.", { cause: err });
        if (err.reason === "denied") throw new AppError("AWS_ROLE_UNAVAILABLE", "AWS role could not be assumed.", { cause: err });
        throw new AppError("AWS_UNAVAILABLE", "AWS STS is temporarily unavailable.", { cause: err });
      }
      throw err;
    }
  }
  return { session, regions: effectiveRegions(conn.enabledRegions, conn.regionAllowlist), awsAccountId };
}

export async function withAwsSession<T>(
  organizationId: string,
  accountRefId: string,
  purpose: string,
  fn: (opened: OpenedSession) => Promise<T>,
): Promise<T> {
  const opened = await openAwsSession(organizationId, accountRefId, purpose);
  try {
    return await fn(opened);
  } finally {
    opened.session.dispose();
  }
}
