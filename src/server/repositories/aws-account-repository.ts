import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb, type Tx } from "../db";

/**
 * AWS account/connection data access. The PUBLIC select deliberately excludes every encrypted
 * column (externalIdEnc, accessKeyIdEnc, secretAccessKeyEnc) — those are only read through
 * `findSecretsForSession`, whose result never leaves the server-side session service.
 */
export const PUBLIC_ACCOUNT_SELECT = {
  id: true,
  awsAccountId: true,
  displayName: true,
  partition: true,
  lastSyncedAt: true,
  syntheticData: true,
  syncStatus: true,
  syncError: true,
  createdAt: true,
  connection: {
    select: {
      id: true,
      method: true,
      roleArn: true,
      actionRoleArn: true,
      status: true,
      statusMessage: true,
      diagnostics: true,
      enabledRegions: true,
      regionAllowlist: true,
      lastValidatedAt: true,
      accessKeyHint: true,
      credentialRotatedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.AwsAccountSelect;

export type PublicAccount = Prisma.AwsAccountGetPayload<{ select: typeof PUBLIC_ACCOUNT_SELECT }>;

export async function listAccounts(organizationId: string): Promise<PublicAccount[]> {
  return getDb().awsAccount.findMany({ where: { organizationId }, select: PUBLIC_ACCOUNT_SELECT, orderBy: { createdAt: "asc" } });
}

export async function findAccount(organizationId: string, accountRefId: string): Promise<PublicAccount | null> {
  return getDb().awsAccount.findFirst({ where: { id: accountRefId, organizationId }, select: PUBLIC_ACCOUNT_SELECT });
}

export async function findAccountByAwsId(organizationId: string, awsAccountId: string) {
  return getDb().awsAccount.findUnique({
    where: { organizationId_awsAccountId: { organizationId, awsAccountId } },
    select: PUBLIC_ACCOUNT_SELECT,
  });
}

/** Server-internal: encrypted secret columns for opening an AWS session. Never serialise. */
export async function findSecretsForSession(organizationId: string, accountRefId: string) {
  return getDb().awsConnection.findFirst({
    where: { organizationId, awsAccountRefId: accountRefId },
    select: {
      id: true,
      method: true,
      roleArn: true,
      status: true,
      externalIdEnc: true,
      accessKeyIdEnc: true,
      secretAccessKeyEnc: true,
      enabledRegions: true,
      regionAllowlist: true,
      awsAccount: { select: { awsAccountId: true, partition: true } },
    },
  });
}

export async function updateConnection(organizationId: string, accountRefId: string, data: Prisma.AwsConnectionUpdateManyMutationInput, tx?: Tx) {
  return (tx ?? getDb()).awsConnection.updateMany({ where: { organizationId, awsAccountRefId: accountRefId }, data });
}

export async function deleteAccount(organizationId: string, accountRefId: string) {
  return getDb().awsAccount.deleteMany({ where: { id: accountRefId, organizationId } });
}

export async function listConnectedAccountRefs(organizationId?: string) {
  return getDb().awsAccount.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      connection: { status: { in: ["CONNECTED", "NEEDS_ATTENTION", "PERMISSION_PROBLEM"] } },
    },
    select: { id: true, organizationId: true, awsAccountId: true },
  });
}
