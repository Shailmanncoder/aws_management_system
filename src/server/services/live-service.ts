import "server-only";
import type { OrgAccess } from "../authz/guard";
import { getDb } from "../db";

export interface LiveSnapshot {
  inventoryVersion: number;
  activeJobs: { type: string; status: string; account: string | null }[];
  lastFinishedAt: string | null;
  openAlerts: number;
  accounts: { id: string; syncStatus: string; connectionStatus: string | null }[];
}

/** Cheap, tenant-scoped snapshot used by the live-updates stream. */
export async function liveSnapshot(access: OrgAccess): Promise<LiveSnapshot> {
  const db = getDb();
  const [org, jobs, last, alerts, accounts] = await Promise.all([
    db.organization.findUnique({ where: { id: access.organizationId }, select: { inventoryVersion: true } }),
    db.syncJob.findMany({
      where: { organizationId: access.organizationId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { type: true, status: true, awsAccount: { select: { displayName: true } } },
      take: 50,
    }),
    db.syncJob.findFirst({ where: { organizationId: access.organizationId, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    access.can("alerts:read") ? db.alert.count({ where: { organizationId: access.organizationId, status: "OPEN" } }) : Promise.resolve(0),
    db.awsAccount.findMany({ where: { organizationId: access.organizationId }, select: { id: true, syncStatus: true, connection: { select: { status: true } } } }),
  ]);
  return {
    inventoryVersion: org?.inventoryVersion ?? 0,
    activeJobs: jobs.map((j) => ({ type: j.type, status: j.status, account: j.awsAccount?.displayName ?? null })),
    lastFinishedAt: last?.finishedAt?.toISOString() ?? null,
    openAlerts: alerts,
    accounts: accounts.map((a) => ({ id: a.id, syncStatus: a.syncStatus, connectionStatus: a.connection?.status ?? null })),
  };
}
