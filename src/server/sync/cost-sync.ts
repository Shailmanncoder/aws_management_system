import "server-only";
import type { WriteFence } from "../jobs/lease";
import { fetchInvoices, type InvoiceSummary } from "../aws/invoices";
import type { SyncJob } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { fetchCosts, type CeDimension, type CostRow } from "../aws/cost-explorer";
import { classifyAwsError } from "../aws/errors";
import { describeAwsFailure, failureSummary } from "../aws/aws-failure";
import { withRetry } from "../aws/retry";
import { getDb } from "../db";
import { AppError } from "../errors";
import { logger } from "../logging/logger";
import { withAwsSession } from "../services/aws-session-service";
import type { JobResult } from "../jobs/runner";

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Initial backfill covers ~13 months; later runs re-fetch 45 days (recent data is restated). */
export function costWindows(hasHistory: boolean, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = ymd(new Date(today.getTime() + DAY)); // CE end date is exclusive
  const dailyStart = ymd(new Date(today.getTime() - (hasHistory ? 45 : 395) * DAY));
  const monthsBack = hasHistory ? 2 : 13;
  const monthlyStart = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1)));
  return { end, dailyStart, monthlyStart };
}

/**
 * COST_SYNC: pulls Cost Explorer data into CostRecord. Idempotent: the fetched window is
 * replaced atomically, so re-runs never duplicate and restated values overwrite old ones.
 */
export async function runCostSync(job: SyncJob, fence?: WriteFence): Promise<JobResult> {
  if (!job.awsAccountRefId) throw new AppError("VALIDATION_FAILED", "Cost sync requires an AWS account.");
  const organizationId = job.organizationId;
  const accountRefId = job.awsAccountRefId;
  const db = getDb();
  const account = await db.awsAccount.findFirstOrThrow({ where: { id: accountRefId, organizationId }, select: { costScopeVersion: true } });
  // "History" means *usable* history. Cost Explorer returns zero-amount periods with no groups
  // for up to ~24h after it is first enabled; if everything stored is zero we must re-backfill
  // once AWS has prepared the data, otherwise the incremental window would keep the zeros.
  const usableHistory = await db.costRecord.count({
    where: { organizationId, awsAccountRefId: accountRefId, granularity: "DAILY", amount: { not: 0 } },
    take: 1,
  });
  const hasHistory = account.costScopeVersion === 1 && usableHistory > 0;
  const w = costWindows(hasHistory);

  const plan: { granularity: "DAILY" | "MONTHLY"; dimension: CeDimension; start: string }[] = [
    { granularity: "DAILY", dimension: "TOTAL", start: w.dailyStart },
    { granularity: "DAILY", dimension: "SERVICE", start: w.dailyStart },
    { granularity: "DAILY", dimension: "REGION", start: w.dailyStart },
    { granularity: "MONTHLY", dimension: "TOTAL", start: w.monthlyStart },
    { granularity: "MONTHLY", dimension: "SERVICE", start: w.monthlyStart },
    { granularity: "MONTHLY", dimension: "REGION", start: w.monthlyStart },
    { granularity: "MONTHLY", dimension: "LINKED_ACCOUNT", start: w.monthlyStart },
  ];

  try {
    const { results, requests, invoices, invoiceError } = await withAwsSession(organizationId, accountRefId, "cost", async ({ session }) => {
      const out: { granularity: "DAILY" | "MONTHLY"; dimension: CeDimension; start: string; rows: CostRow[] }[] = [];
      let n = 0;
      // Sequential on purpose: Cost Explorer has low per-account TPS limits.
      for (const p of plan) {
        const res = await withRetry(() => fetchCosts(session, { start: p.start, end: w.end, granularity: p.granularity, dimension: p.dimension }));
        n += res.requests;
        out.push({ ...p, rows: res.rows });
      }
      let invoices: InvoiceSummary[] | null = null;
      let invoiceError: string | null = null;
      try { invoices = await withRetry(() => fetchInvoices(session)); }
      catch (err) { invoiceError = classifyAwsError(err) === "access_denied" ? "Invoice currency is unavailable: grant invoicing:ListInvoiceSummaries in the read-only role." : "Invoice details could not be refreshed. Usage costs retain their original reported currency."; }
      return { results: out, requests: n, invoices, invoiceError };
    });

    let written = 0;
    await db.$transaction(
      async (tx) => {
        await fence?.(tx);
        if (account.costScopeVersion !== 1) await tx.costRecord.deleteMany({ where: { organizationId, awsAccountRefId: accountRefId } });
        for (const r of results) {
          await tx.costRecord.deleteMany({
            where: { organizationId, awsAccountRefId: accountRefId, granularity: r.granularity, dimension: r.dimension, periodStart: { gte: new Date(`${r.start}T00:00:00Z`) } },
          });
          if (r.rows.length === 0) continue;
          await tx.costRecord.createMany({
            data: r.rows.map((row) => ({
              organizationId,
              awsAccountRefId: accountRefId,
              granularity: r.granularity,
              periodStart: new Date(`${row.periodStart}T00:00:00Z`),
              dimension: row.dimension,
              dimensionKey: row.key,
              amount: new Prisma.Decimal(row.amount.toFixed(6)),
              unit: row.unit,
              estimated: row.estimated,
            })),
            skipDuplicates: true,
          });
          written += r.rows.length;
        }
        await tx.awsAccount.updateMany({ where: { organizationId, id: accountRefId }, data: {
          costScopeVersion: 1, invoiceSyncError: invoiceError,
          ...(invoices === null ? {} : { invoiceSummaries: invoices, invoiceSyncedAt: new Date() }),
        } });
        await tx.organization.update({ where: { id: organizationId }, data: { inventoryVersion: { increment: 1 } } });
      },
      { timeout: 60_000 },
    );
    return { status: "SUCCEEDED", metrics: { rows: written, costExplorerRequests: requests, backfill: !hasHistory } };
  } catch (err) {
    // Report exactly which AWS call failed and why (AWS returns AccessDeniedException both for a
    // missing permission and for "Cost Explorer not enabled" — they need different fixes).
    const failure = describeAwsFailure(err, "ce:GetCostAndUsage");
    if (["service_not_enabled", "permission_denied", "explicit_deny", "scp_denied"].includes(failure.reason)) {
      logger.warn("cost sync blocked", { reason: failure.reason, action: failure.action, errorCode: failure.errorCode });
      return { status: "FAILED", errorSummary: `Billing data is not available: ${failureSummary(failure)}`, metrics: { failureReason: failure.reason, action: failure.action, errorCode: failure.errorCode } };
    }
    const cls = classifyAwsError(err);
    logger.warn("cost sync failed", { errorClass: cls });
    throw err;
  }
}
