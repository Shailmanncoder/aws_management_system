import "server-only";
import type { AuditOutcome, Prisma } from "@/generated/prisma/client";
import { getDb } from "../db";

export interface AuditInsert {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType?: "USER" | "SYSTEM";
  action: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  outcome: AuditOutcome;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/** Append-only: this repository deliberately exposes no update/delete. */
export async function insertAudit(entry: AuditInsert) {
  return getDb().auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType ?? "USER",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      requestId: entry.requestId,
      outcome: entry.outcome,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent?.slice(0, 512),
    },
    select: { id: true },
  });
}

export async function listAudit(
  organizationId: string,
  opts: { cursor?: string; limit: number; action?: string; outcome?: AuditOutcome },
) {
  const rows = await getDb().auditLog.findMany({
    where: {
      organizationId,
      ...(opts.action ? { action: { startsWith: opts.action } } : {}),
      ...(opts.outcome ? { outcome: opts.outcome } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      actorType: true,
      targetType: true,
      targetId: true,
      requestId: true,
      outcome: true,
      metadata: true,
      ipAddress: true,
      createdAt: true,
      actor: { select: { id: true, email: true, name: true } },
    },
  });
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}
