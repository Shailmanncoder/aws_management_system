import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  buildDiagnosticReply,
  type DiagnosticIssue,
  type DiagnosticMemoryMessage,
} from "@/lib/diagnostic-assistant";
import { redactString } from "../logging/redact";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";

const MEMORY_KIND = "DIAGNOSTIC_ASSISTANT_MEMORY";
const MAX_MEMORY = 20;

export const diagnosticQuestionInput = z.strictObject({
  question: z.string().trim().min(2).max(500),
});

type Probe = { capability?: unknown; status?: unknown; iamAction?: unknown; message?: unknown };

/** Credential-shaped values are removed before text enters assistant memory or reasoning. */
export function sanitizeAssistantText(value: string): string {
  return redactString(value.trim()).slice(0, 500);
}

function safeDiagnostics(value: Prisma.JsonValue | null): Probe[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const probes = (value as Record<string, unknown>).probes;
  if (!Array.isArray(probes)) return [];
  return probes.flatMap((probe): Probe[] => {
    if (!probe || typeof probe !== "object" || Array.isArray(probe)) return [];
    const raw = probe as Record<string, unknown>;
    return [{
      capability: typeof raw.capability === "string" ? sanitizeAssistantText(raw.capability) : undefined,
      status: typeof raw.status === "string" ? sanitizeAssistantText(raw.status) : undefined,
      iamAction: typeof raw.iamAction === "string" ? sanitizeAssistantText(raw.iamAction) : undefined,
      message: typeof raw.message === "string" ? sanitizeAssistantText(raw.message) : undefined,
    }];
  });
}

function readMemory(payload: Prisma.JsonValue): DiagnosticMemoryMessage[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const messages = (payload as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message): DiagnosticMemoryMessage[] => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const row = message as Record<string, unknown>;
    if (typeof row.question !== "string" || typeof row.answer !== "string" || typeof row.createdAt !== "string") return [];
    return [{ question: sanitizeAssistantText(row.question), answer: sanitizeAssistantText(row.answer), createdAt: row.createdAt }];
  }).slice(-MAX_MEMORY);
}

async function collectIssues(access: OrgAccess): Promise<DiagnosticIssue[]> {
  const accounts = await getDb().awsAccount.findMany({
    where: { organizationId: access.organizationId },
    select: {
      id: true,
      displayName: true,
      syncStatus: true,
      syncError: true,
      lastSyncedAt: true,
      connection: { select: { status: true, statusMessage: true, diagnostics: true } },
    },
    orderBy: { displayName: "asc" },
  });
  if (accounts.length === 0) {
    return [{
      code: "NO_AWS_ACCOUNTS",
      severity: "warning",
      title: "No AWS account is connected to this workspace",
      detail: "Connections are workspace-wide, so another device must use the same Stratus login and workspace.",
      nextStep: "Select the correct workspace or open Settings → Cloud accounts to connect AWS.",
    }];
  }

  const issues: DiagnosticIssue[] = [];
  for (const account of accounts) {
    const label = sanitizeAssistantText(account.displayName);
    if (!account.connection || !["CONNECTED", "NEEDS_ATTENTION"].includes(account.connection.status)) {
      issues.push({
        code: `CONNECTION_${account.connection?.status ?? "MISSING"}`,
        severity: account.connection?.status === "DISCONNECTED" ? "warning" : "critical",
        title: `${label} connection is ${account.connection?.status.toLowerCase().replaceAll("_", " ") ?? "missing"}`,
        detail: sanitizeAssistantText(account.connection?.statusMessage ?? "The AWS role has not completed verification."),
        nextStep: "Open Settings → Cloud accounts, select this account, and finish or repair its role setup.",
        accountId: account.id,
      });
    }
    if (["FAILED", "PARTIAL"].includes(account.syncStatus)) {
      issues.push({
        code: `SYNC_${account.syncStatus}`,
        severity: account.syncStatus === "FAILED" ? "critical" : "warning",
        title: `${label} synchronization ${account.syncStatus.toLowerCase()}`,
        detail: sanitizeAssistantText(account.syncError ?? "The latest synchronization did not complete."),
        nextStep: "Review the account diagnostics, correct the named permission or role issue, then run Refresh again.",
        accountId: account.id,
      });
    } else if (!account.lastSyncedAt) {
      issues.push({
        code: "SYNC_NOT_COMPLETED",
        severity: "info",
        title: `${label} has not completed its first synchronization`,
        detail: "The connection exists, but Stratus has not received a completed inventory run yet.",
        nextStep: "Confirm the worker is running, then use Refresh on the Overview page.",
        accountId: account.id,
      });
    }
    for (const probe of safeDiagnostics(account.connection?.diagnostics ?? null)) {
      if (probe.status === "OK") continue;
      const capability = typeof probe.capability === "string" ? probe.capability : "AWS capability";
      const missing = probe.status === "DENIED" && typeof probe.iamAction === "string" ? ` Missing permission: ${probe.iamAction}.` : "";
      const nextStep = probe.status === "NOT_ENABLED"
        ? `Enable ${capability} in the AWS account if you need that coverage, then run Refresh again.`
        : probe.status === "DENIED"
          ? "Update the StratusReadOnlyRole with the permission shown in the account diagnostics, then verify the connection again."
          : "Retry the connection check. If it repeats, review the AWS service status and the account diagnostics.";
      issues.push({
        code: `PERMISSION_${capability.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`,
        severity: probe.status === "NOT_ENABLED" ? "info" : "warning",
        title: `${label}: ${capability} needs attention`,
        detail: `${typeof probe.message === "string" ? probe.message : "AWS denied or could not complete this check."}${missing}`,
        nextStep,
        accountId: account.id,
      });
    }
  }
  return issues.slice(0, 30);
}

async function memoryFor(access: OrgAccess) {
  return getDb().workspaceRecord.findFirst({
    where: { organizationId: access.organizationId, userId: access.userId, kind: MEMORY_KIND, shared: false },
  });
}

export async function getDiagnosticAssistant(access: OrgAccess) {
  assertCan(access, "org:read");
  const [issues, memory] = await Promise.all([collectIssues(access), memoryFor(access)]);
  return { issues, messages: memory ? readMemory(memory.payload) : [], privacy: "local-redacted" as const };
}

export async function askDiagnosticAssistant(access: OrgAccess, input: z.infer<typeof diagnosticQuestionInput>) {
  assertCan(access, "org:read");
  const db = getDb();
  const [issues, existing] = await Promise.all([collectIssues(access), memoryFor(access)]);
  const question = sanitizeAssistantText(input.question);
  const answer = buildDiagnosticReply(question, issues);
  const message = { question, answer, createdAt: new Date().toISOString() } satisfies DiagnosticMemoryMessage;
  const messages = [...(existing ? readMemory(existing.payload) : []), message].slice(-MAX_MEMORY);
  const payload = { messages, privacy: "No credentials, secrets, tokens, external IDs, cookies, or raw AWS responses." } as Prisma.InputJsonValue;
  if (existing) {
    await db.workspaceRecord.updateMany({
      where: { id: existing.id, organizationId: access.organizationId, userId: access.userId, kind: MEMORY_KIND },
      data: { payload, version: { increment: 1 } },
    });
  } else {
    await db.workspaceRecord.create({
      data: { organizationId: access.organizationId, userId: access.userId, kind: MEMORY_KIND, name: "Private diagnostic memory", shared: false, payload },
    });
  }
  return { message, issues, privacy: "local-redacted" as const };
}
