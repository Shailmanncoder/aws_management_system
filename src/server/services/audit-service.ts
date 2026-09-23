import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getContext } from "../logging/context";
import { logger } from "../logging/logger";
import { redact } from "../logging/redact";
import { insertAudit, type AuditInsert } from "../repositories/audit-repository";

/** Catalogue of audited actions (kept as constants so they are greppable and consistent). */
export const AUDIT = {
  CLOUD_CONNECTED: "cloud.connected",
  CLOUD_SYNCED: "cloud.synced",
  CLOUD_DISCONNECTED: "cloud.disconnected",
  PROJECT_CHANGED: "project.changed",
  HELP_CHANGED: "help.changed",
  LOGIN: "auth.login",
  SIGNUP: "auth.signup",
  ORG_CREATED: "org.created",
  ORG_UPDATED: "org.updated",
  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  MEMBER_REMOVED: "member.removed",
  INVITE_REVOKED: "member.invite_revoked",
  AWS_CONNECTION_STARTED: "aws.connection_started",
  AWS_CONNECTED: "aws.connected",
  AWS_CONNECTION_FAILED: "aws.connection_failed",
  AWS_REVALIDATED: "aws.revalidated",
  AWS_DISCONNECTED: "aws.disconnected",
  AWS_CREDENTIALS_ROTATED: "aws.credentials_rotated",
  SYNC_STARTED: "sync.started",
  SYNC_COMPLETED: "sync.completed",
  SYNC_FAILED: "sync.failed",
  REPORT_EXPORTED: "report.exported",
  FINDING_REOPENED: "finding.reopened",
  FINDING_SUPPRESSED: "finding.suppressed",
  ALERT_RULE_CHANGED: "alert.rule_changed",
  ALERT_ACKNOWLEDGED: "alert.acknowledged",
  ACTION_REQUESTED: "aws_action.requested",
  ACTION_COMPLETED: "aws_action.completed",
  ACTION_MODE_CHANGED: "org.action_mode_changed",
  PLATFORM_CREDENTIALS_SET: "platform.credentials_set",
  PLATFORM_CREDENTIALS_CLEARED: "platform.credentials_cleared",
  PLATFORM_CREDENTIALS_REJECTED: "platform.credentials_rejected",
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

/**
 * Records an audit event. Metadata is redacted before persistence. Failures are logged loudly
 * but do not break the user flow (e.g. login) — alert on `audit write failed` in production.
 */
export async function recordAudit(entry: Omit<AuditInsert, "requestId" | "metadata" | "action"> & {
  action: AuditAction;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const ctx = getContext();
  try {
    await insertAudit({
      ...entry,
      requestId: ctx?.requestId,
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
    });
  } catch (err) {
    logger.error("audit write failed", { action: entry.action, err });
  }
}
