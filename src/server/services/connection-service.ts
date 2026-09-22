import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConnectionStatus, Prisma } from "@/generated/prisma/client";
import { parseRoleArn } from "../aws/arn";
import { runDiagnostics, type DiagnosticsSummary } from "../aws/diagnostics";
import { listEnabledRegions } from "../aws/regions";
import { isKnownRegion } from "../aws/regions-catalog";
import type { AwsSession } from "../aws/session";
import { accessKeySession, AssumeRoleError, assumeRoleSession, buildSessionName, getCallerIdentity } from "../aws/sts";
import {
  dataPlaneDenyPolicy,
  manualSetupCommands,
  READ_ROLE_NAME,
  readOnlyPolicy,
  readOnlyRoleTemplate,
  trustPolicy,
} from "../aws/templates";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { getEnv } from "../env";
import { AppError, conflict, notFound } from "../errors";
import { logger } from "../logging/logger";
import {
  deleteAccount,
  findAccount,
  findAccountByAwsId,
  findSecretsForSession,
  listAccounts,
  PUBLIC_ACCOUNT_SELECT,
  updateConnection,
  type PublicAccount,
} from "../repositories/aws-account-repository";
import { generateExternalId } from "../security/crypto";
import { decryptSecret, encryptSecret } from "../security/envelope";
import { awsAccountIdSchema } from "../validation/common";
import { AUDIT, recordAudit } from "./audit-service";
import { accessKeyContext, externalIdContext } from "./aws-session-service";
import { enqueueInitialSync } from "./sync-service";

export const startConnectionInput = z.strictObject({
  awsAccountId: awsAccountIdSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\u0000-\u001F\u007F<>]+$/, "Name contains unsupported characters"),
});

export const validateConnectionInput = z.strictObject({
  roleArn: z.string().trim().max(2048).optional(),
});

export const accessKeyInput = z.strictObject({
  accessKeyId: z.string().regex(/^AKIA[A-Z0-9]{16}$/, "Must be a long-term access key ID (AKIA…)"),
  secretAccessKey: z.string().regex(/^[A-Za-z0-9/+=]{40}$/, "Invalid secret access key format"),
});

export const regionAllowlistInput = z.strictObject({
  regionAllowlist: z.array(z.string()).max(40),
});

/** Invalidates tenant-scoped caches (account list / connection state changed). */
async function bumpVersion(organizationId: string) {
  await getDb().organization.update({ where: { id: organizationId }, data: { inventoryVersion: { increment: 1 } } });
}

/** Public, secret-free view of an account + connection. */
export function toAccountView(a: PublicAccount) {
  return {
    id: a.id,
    awsAccountId: a.awsAccountId,
    displayName: a.displayName,
    partition: a.partition,
    lastSyncedAt: a.lastSyncedAt,
    syncStatus: a.syncStatus,
    syncError: a.syncError,
    createdAt: a.createdAt,
    connection: a.connection
      ? {
          method: a.connection.method,
          roleArn: a.connection.roleArn,
          status: a.connection.status,
          statusMessage: a.connection.statusMessage,
          diagnostics: a.connection.diagnostics as DiagnosticsSummary | null,
          enabledRegions: a.connection.enabledRegions,
          regionAllowlist: a.connection.regionAllowlist,
          lastValidatedAt: a.connection.lastValidatedAt,
          accessKeyHint: a.connection.accessKeyHint,
          credentialRotatedAt: a.connection.credentialRotatedAt,
        }
      : null,
  };
}
export type AccountView = ReturnType<typeof toAccountView>;

export async function listAwsAccounts(access: OrgAccess): Promise<AccountView[]> {
  assertCan(access, "aws_accounts:read");
  return (await listAccounts(access.organizationId)).map(toAccountView);
}

export async function getAwsAccount(access: OrgAccess, accountRefId: string): Promise<AccountView> {
  assertCan(access, "aws_accounts:read");
  const a = await findAccount(access.organizationId, accountRefId);
  if (!a) throw notFound("AWS account");
  return toAccountView(a);
}

/** Wizard steps 1–2: declare the expected account and generate a fresh ExternalId. */
export async function startConnection(access: OrgAccess, input: z.infer<typeof startConnectionInput>): Promise<AccountView> {
  assertCan(access, "aws_accounts:connect");
  if (input.awsAccountId === getEnv().PLATFORM_AWS_ACCOUNT_ID && !getEnv().ALLOW_PLATFORM_ACCOUNT_CONNECTION) {
    throw new AppError("VALIDATION_FAILED", "This AWS account cannot be connected.");
  }
  const existing = await findAccountByAwsId(access.organizationId, input.awsAccountId);
  if (existing) {
    const resumable: ConnectionStatus[] = ["PENDING", "CONNECTION_FAILED"];
    if (existing.connection && resumable.includes(existing.connection.status)) return toAccountView(existing);
    throw conflict("This AWS account is already connected to this workspace.");
  }

  const accountRefId = randomUUID();
  const externalIdEnc = await encryptSecret(generateExternalId(), externalIdContext(access.organizationId, accountRefId));
  const created = await getDb().awsAccount.create({
    data: {
      id: accountRefId,
      organizationId: access.organizationId,
      awsAccountId: input.awsAccountId,
      displayName: input.displayName,
      connection: {
        create: {
          organizationId: access.organizationId,
          method: "ASSUME_ROLE",
          externalIdEnc,
          status: "PENDING",
          createdById: access.userId,
        },
      },
    },
    select: PUBLIC_ACCOUNT_SELECT,
  });
  await bumpVersion(access.organizationId);
  await recordAudit({
    action: AUDIT.AWS_CONNECTION_STARTED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "aws_account",
    targetId: accountRefId,
    metadata: { awsAccountId: input.awsAccountId },
  });
  return toAccountView(created);
}

/** Wizard step 3: everything the customer needs to create the role. Admin-only (reveals ExternalId). */
export async function getSetupInstructions(access: OrgAccess, accountRefId: string) {
  assertCan(access, "aws_accounts:connect");
  const secrets = await findSecretsForSession(access.organizationId, accountRefId);
  if (!secrets) throw notFound("AWS account");
  const env = getEnv();
  const externalId = await decryptSecret(secrets.externalIdEnc, externalIdContext(access.organizationId, accountRefId));
  return {
    awsAccountId: secrets.awsAccount.awsAccountId,
    principalArn: env.PLATFORM_AWS_PRINCIPAL_ARN,
    externalId,
    roleName: READ_ROLE_NAME,
    cloudFormationTemplate: readOnlyRoleTemplate(env.PLATFORM_AWS_PRINCIPAL_ARN, externalId),
    trustPolicy: trustPolicy(env.PLATFORM_AWS_PRINCIPAL_ARN, externalId),
    readOnlyPolicy: readOnlyPolicy(),
    denyPolicy: dataPlaneDenyPolicy(),
    cliCommands: manualSetupCommands(),
  };
}

function statusFromDiagnostics(d: DiagnosticsSummary): { status: ConnectionStatus; message: string } {
  if (!d.requiredOk) {
    const missing = d.probes.filter((p) => p.required && p.status !== "OK").map((p) => p.iamAction);
    return { status: "PERMISSION_PROBLEM", message: `Missing required AWS permission: ${missing.join(", ")}` };
  }
  if (d.optionalIssues > 0) {
    return { status: "NEEDS_ATTENTION", message: `${d.optionalIssues} optional capability check(s) failed. Some data will be unavailable.` };
  }
  return { status: "CONNECTED", message: "Connected with read-only access." };
}

/**
 * Wizard steps 4–10 (and re-validation): validate ARN → AssumeRole(ExternalId) →
 * GetCallerIdentity → account match → region discovery → diagnostics → persist metadata.
 * Temporary credentials never leave this function's call stack.
 */
export async function validateConnection(access: OrgAccess, accountRefId: string, input: z.infer<typeof validateConnectionInput>): Promise<AccountView> {
  assertCan(access, "aws_accounts:connect");
  const secrets = await findSecretsForSession(access.organizationId, accountRefId);
  if (!secrets) throw notFound("AWS account");
  if (secrets.method !== "ASSUME_ROLE") throw new AppError("PRECONDITION_FAILED", "This account uses access-key credentials.");

  const env = getEnv();
  const expected = secrets.awsAccount.awsAccountId;
  const parsed = parseRoleArn(input.roleArn ?? secrets.roleArn);
  if (!parsed) {
    throw new AppError("VALIDATION_FAILED", "Enter a valid IAM role ARN, e.g. arn:aws:iam::123456789012:role/StratusReadOnlyRole.");
  }
  if (parsed.accountId === env.PLATFORM_AWS_ACCOUNT_ID && !env.ALLOW_PLATFORM_ACCOUNT_CONNECTION) {
    throw new AppError("VALIDATION_FAILED", "This role cannot be used.");
  }
  if (parsed.accountId !== expected) {
    throw new AppError("AWS_ACCOUNT_MISMATCH", `The role belongs to a different AWS account than the one declared (${expected}).`);
  }

  const wasConnected = secrets.status !== "PENDING" && secrets.status !== "CONNECTION_FAILED";
  const fail = async (status: ConnectionStatus, code: "AWS_ASSUME_ROLE_FAILED" | "AWS_ROLE_UNAVAILABLE" | "AWS_ACCOUNT_MISMATCH", message: string, cause?: unknown) => {
    await updateConnection(access.organizationId, accountRefId, { roleArn: parsed.arn, status, statusMessage: message, lastValidatedAt: new Date() });
    await recordAudit({
      action: AUDIT.AWS_CONNECTION_FAILED,
      organizationId: access.organizationId,
      actorUserId: access.userId,
      outcome: "FAILURE",
      targetType: "aws_account",
      targetId: accountRefId,
      metadata: { status },
    });
    return new AppError(code, message, { cause });
  };

  let session: AwsSession | undefined;
  try {
    try {
      session = await assumeRoleSession({
        roleArn: parsed.arn,
        externalId: await decryptSecret(secrets.externalIdEnc, externalIdContext(access.organizationId, accountRefId)),
        sessionName: buildSessionName("validate", secrets.id.slice(0, 8)),
        partition: parsed.partition,
        expectedAccountId: expected,
        durationSeconds: 900,
      });
    } catch (err) {
      if (err instanceof AssumeRoleError && err.reason === "denied") {
        throw await fail(
          wasConnected ? "ROLE_UNAVAILABLE" : "CONNECTION_FAILED",
          wasConnected ? "AWS_ROLE_UNAVAILABLE" : "AWS_ASSUME_ROLE_FAILED",
          "AWS role could not be assumed. Check that the role exists, trusts the Stratus principal, and uses the exact ExternalId shown in setup.",
          err,
        );
      }
      if (err instanceof AssumeRoleError && err.reason === "throttled") {
        throw new AppError("AWS_THROTTLED", "AWS API request was throttled. Please retry shortly.", { cause: err });
      }
      logger.error("assume role infrastructure failure", { err });
      throw new AppError("SERVICE_UNAVAILABLE", "AWS connection validation is temporarily unavailable.", { cause: err });
    }

    const identity = await getCallerIdentity(session);
    if (identity.account !== expected) {
      throw await fail("CONNECTION_FAILED", "AWS_ACCOUNT_MISMATCH", "The connected AWS account does not match the declared account.");
    }

    let regions: string[] = [];
    try {
      regions = await listEnabledRegions(session);
    } catch (err) {
      logger.warn("region discovery failed", { err });
    }
    const probeRegion = regions.includes(env.PLATFORM_AWS_REGION) ? env.PLATFORM_AWS_REGION : (regions[0] ?? env.PLATFORM_AWS_REGION);
    const diagnostics = await runDiagnostics(session, probeRegion, { includeBilled: true });
    const regionProbe = {
      capability: "regions" as const,
      label: "Region discovery",
      iamAction: "ec2:DescribeRegions",
      required: true,
      status: regions.length > 0 ? ("OK" as const) : ("DENIED" as const),
      message: regions.length > 0 ? undefined : "Missing required AWS permission: ec2:DescribeRegions",
    };
    const summary: DiagnosticsSummary = {
      ...diagnostics,
      probes: [regionProbe, ...diagnostics.probes],
      requiredOk: diagnostics.requiredOk && regions.length > 0,
    };
    const { status, message } = statusFromDiagnostics(summary);

    await updateConnection(access.organizationId, accountRefId, {
      roleArn: parsed.arn,
      status,
      statusMessage: message,
      diagnostics: summary as unknown as Prisma.InputJsonValue,
      enabledRegions: regions,
      lastValidatedAt: new Date(),
    });
    await bumpVersion(access.organizationId);
    if (!wasConnected && status !== "PERMISSION_PROBLEM") {
      await enqueueInitialSync(access.organizationId, accountRefId, access.userId);
    }
    await recordAudit({
      action: wasConnected ? AUDIT.AWS_REVALIDATED : AUDIT.AWS_CONNECTED,
      organizationId: access.organizationId,
      actorUserId: access.userId,
      outcome: "SUCCESS",
      targetType: "aws_account",
      targetId: accountRefId,
      metadata: { status, regions: regions.length },
    });
    return getAwsAccount(access, accountRefId);
  } finally {
    session?.dispose();
  }
}

/** Access-key connection (dev / explicitly permitted deployments). Root credentials are rejected. */
export async function connectWithAccessKey(access: OrgAccess, accountRefId: string, input: z.infer<typeof accessKeyInput>): Promise<AccountView> {
  assertCan(access, "aws_accounts:connect");
  if (!getEnv().ALLOW_ACCESS_KEY_CONNECTIONS) {
    throw new AppError("FEATURE_DISABLED", "Access-key connections are disabled. Use IAM role onboarding.");
  }
  const account = await findAccount(access.organizationId, accountRefId);
  if (!account?.connection) throw notFound("AWS account");

  const session = accessKeySession({ ...input, accountId: account.awsAccountId, partition: account.partition });
  try {
    const identity = await getCallerIdentity(session).catch((cause: unknown) => {
      throw new AppError("AWS_ASSUME_ROLE_FAILED", "The access key could not be validated.", { cause });
    });
    if (identity.isRoot) {
      await recordAudit({ action: AUDIT.AWS_CONNECTION_FAILED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "FAILURE", targetType: "aws_account", targetId: accountRefId, metadata: { reason: "root_credentials" } });
      throw new AppError("VALIDATION_FAILED", "AWS root account credentials are not accepted. Create a dedicated IAM role instead.");
    }
    if (identity.account !== account.awsAccountId) {
      throw new AppError("AWS_ACCOUNT_MISMATCH", "The access key belongs to a different AWS account than the one declared.");
    }
    const regions = await listEnabledRegions(session).catch(() => [] as string[]);
    const diagnostics = await runDiagnostics(session, regions[0] ?? getEnv().PLATFORM_AWS_REGION, { includeBilled: true });
    const { status, message } = statusFromDiagnostics(diagnostics);
    const rotating = account.connection.method === "ACCESS_KEY" && account.connection.accessKeyHint !== null;

    await updateConnection(access.organizationId, accountRefId, {
      method: "ACCESS_KEY",
      accessKeyIdEnc: await encryptSecret(input.accessKeyId, accessKeyContext(access.organizationId, accountRefId, "id")),
      secretAccessKeyEnc: await encryptSecret(input.secretAccessKey, accessKeyContext(access.organizationId, accountRefId, "secret")),
      accessKeyHint: `…${input.accessKeyId.slice(-4)}`,
      credentialRotatedAt: new Date(),
      status,
      statusMessage: `${message} Access-key mode is not recommended; migrate to IAM role onboarding.`,
      diagnostics: diagnostics as unknown as Prisma.InputJsonValue,
      enabledRegions: regions,
      lastValidatedAt: new Date(),
    });
    await recordAudit({
      action: rotating ? AUDIT.AWS_CREDENTIALS_ROTATED : AUDIT.AWS_CONNECTED,
      organizationId: access.organizationId,
      actorUserId: access.userId,
      outcome: "SUCCESS",
      targetType: "aws_account",
      targetId: accountRefId,
      metadata: { method: "ACCESS_KEY", status },
    });
    return getAwsAccount(access, accountRefId);
  } finally {
    session.dispose();
  }
}

export async function setRegionAllowlist(access: OrgAccess, accountRefId: string, regions: string[]): Promise<AccountView> {
  assertCan(access, "aws_accounts:connect");
  const account = await findAccount(access.organizationId, accountRefId);
  if (!account?.connection) throw notFound("AWS account");
  const unique = [...new Set(regions)];
  const enabled = new Set(account.connection.enabledRegions);
  if (!unique.every((r) => isKnownRegion(r) && enabled.has(r))) {
    throw new AppError("VALIDATION_FAILED", "Regions must be enabled regions of this AWS account.");
  }
  await updateConnection(access.organizationId, accountRefId, { regionAllowlist: unique });
  return getAwsAccount(access, accountRefId);
}

/**
 * Disconnect: deletes the account row, which cascades the connection metadata (including
 * encrypted ExternalId / keys), inventory, costs and findings for that account.
 */
export async function disconnectAccount(access: OrgAccess, accountRefId: string): Promise<void> {
  assertCan(access, "aws_accounts:disconnect");
  const account = await findAccount(access.organizationId, accountRefId);
  if (!account) throw notFound("AWS account");
  const activeProvisioning = await getDb().provisioningPlan.count({ where: { organizationId: access.organizationId, accountId: accountRefId, status: { in: ["APPLYING", "UNKNOWN"] } } });
  if (activeProvisioning) throw conflict("Reconcile the in-progress provisioning deployment before disconnecting this account.");
  await deleteAccount(access.organizationId, accountRefId);
  await getDb().organization.update({ where: { id: access.organizationId }, data: { inventoryVersion: { increment: 1 } } });
  await recordAudit({
    action: AUDIT.AWS_DISCONNECTED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "aws_account",
    targetId: accountRefId,
    metadata: { awsAccountId: account.awsAccountId },
  });
}
