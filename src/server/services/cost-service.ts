import "server-only";
import { z } from "zod";
import type { CostDimension, CostGranularity, Prisma } from "@/generated/prisma/client";
import { fillDays, percentChange, projectMonthEnd, RANGE_PRESETS, resolveRange, topNWithOther, utcDay, type RangePreset } from "@/lib/cost-math";
import { assertCan, type OrgAccess } from "../authz/guard";
import { cached } from "../cache/tenant-cache";
import { getDb } from "../db";
import { listAccounts } from "../repositories/aws-account-repository";
import { regionSchema, uuidSchema } from "../validation/common";

const DAY = 86_400_000;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()));

export const costParamsSchema = z
  .object({
    range: z.enum([...(Object.keys(RANGE_PRESETS) as RangePreset[]), "custom"]).catch("30d"),
    from: dateStr.optional().catch(undefined),
    to: dateStr.optional().catch(undefined),
    account: uuidSchema.optional().catch(undefined),
    region: regionSchema.optional().catch(undefined),
    currency: z.string().regex(/^[A-Z]{3}$/).optional().catch(undefined),
  })
  .transform((p) => {
    // Custom ranges must be ordered and at most ~13 months (the synced history).
    if (p.range === "custom") {
      const ok = p.from && p.to && p.from <= p.to && new Date(`${p.to}T00:00:00Z`).getTime() - new Date(`${p.from}T00:00:00Z`).getTime() <= 400 * DAY;
      if (!ok) return { ...p, range: "30d" as const, from: undefined, to: undefined };
    }
    return p;
  });
export type CostParams = z.infer<typeof costParamsSchema>;

export function parseCostParams(raw: Record<string, string | string[] | undefined>): CostParams {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return costParamsSchema.parse(flat);
}

const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d.toString()) : 0);

interface Scope {
  organizationId: string;
  accountRefIds?: string[];
  currency?: string;
}

function baseWhere(s: Scope, granularity: CostGranularity, dimension: CostDimension, start: Date, end: Date, key?: string): Prisma.CostRecordWhereInput {
  return {
    organizationId: s.organizationId,
    awsAccount: { costScopeVersion: 1 },
    ...(s.currency ? { unit: s.currency } : {}),
    granularity,
    dimension,
    periodStart: { gte: start, lte: end },
    ...(s.accountRefIds?.length ? { awsAccountRefId: { in: s.accountRefIds } } : {}),
    ...(key !== undefined ? { dimensionKey: key } : {}),
  };
}

async function sumOver(s: Scope, start: Date, end: Date, region?: string): Promise<{ amount: number; estimated: boolean; days: number }> {
  const where = region ? baseWhere(s, "DAILY", "REGION", start, end, region) : baseWhere(s, "DAILY", "TOTAL", start, end);
  const [agg, est, days] = await Promise.all([
    getDb().costRecord.aggregate({ where, _sum: { amount: true } }),
    getDb().costRecord.count({ where: { ...where, estimated: true } }),
    getDb().costRecord.groupBy({ by: ["periodStart"], where }),
  ]);
  return { amount: num(agg._sum.amount), estimated: est > 0, days: days.length };
}

async function groupSum(s: Scope, dimension: CostDimension, start: Date, end: Date) {
  const rows = await getDb().costRecord.groupBy({ by: ["dimensionKey"], where: baseWhere(s, "DAILY", dimension, start, end), _sum: { amount: true } });
  return rows.map((r) => ({ key: r.dimensionKey, amount: num(r._sum.amount) }));
}

export interface BillingCoverage {
  accountRefId: string;
  name: string;
  status: "available" | "stale" | "unavailable" | "pending";
  message: string | null;
  lastSyncedAt: string | null;
}

async function coverage(organizationId: string, accountRefIds?: string[]): Promise<BillingCoverage[]> {
  const accounts = await getDb().awsAccount.findMany({ where: { organizationId, ...(accountRefIds?.length ? { id: { in: accountRefIds } } : {}) }, select: { id: true, displayName: true, awsAccountId: true, costScopeVersion: true } });
  const db = getDb();
  return Promise.all(
    accounts.map(async (a) => {
      const [lastOk, last] = await Promise.all([
        db.syncJob.findFirst({ where: { organizationId, awsAccountRefId: a.id, type: "COST_SYNC", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
        db.syncJob.findFirst({ where: { organizationId, awsAccountRefId: a.id, type: "COST_SYNC" }, orderBy: { createdAt: "desc" }, select: { status: true, errorSummary: true } }),
      ]);
      const stale = lastOk && (last?.status === "FAILED" || Date.now() - (lastOk.finishedAt?.getTime() ?? 0) > 26 * 60 * 60_000);
      // A successful sync that stored only zero-amount periods means Cost Explorer was enabled very
      // recently and AWS has not finished preparing the data (it can take up to 24h). Reporting
      // "available" there would present a misleading 0.00 as a real total.
      const charged = lastOk ? await db.costRecord.count({ where: { organizationId, awsAccountRefId: a.id, amount: { not: 0 } }, take: 1 }) : 0;
      const preparing = Boolean(lastOk) && charged === 0;
      const status: BillingCoverage["status"] =
        a.costScopeVersion !== 1
          ? last?.status === "FAILED"
            ? "unavailable"
            : "pending"
          : lastOk
            ? preparing
              ? "pending"
              : stale
                ? "stale"
                : "available"
            : last?.status === "FAILED"
              ? "unavailable"
              : "pending";
      return {
        accountRefId: a.id,
        name: `${a.displayName} (${a.awsAccountId})`,
        status,
        message:
          status === "available"
            ? null
            : status === "stale"
              ? "Showing historical billing data. The latest refresh failed or is overdue; totals may be incomplete."
              : status === "unavailable"
                ? (last?.errorSummary ?? "Billing data is not available for this account.")
                : preparing
                  ? "Cost Explorer reported no charges yet. If it was enabled recently, AWS can take up to 24 hours to prepare cost data — then refresh cost data."
                  : "Cost data has not been synchronised yet.",
        lastSyncedAt: lastOk?.finishedAt?.toISOString() ?? null,
      };
    }),
  );
}

/** Month-to-date summary: MTD vs the same number of days last month, and a labelled projection. */
async function summary(s: Scope, now: Date, region?: string) {
  const today = utcDay(now);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const prevEnd = new Date(monthStart.getTime() - DAY);
  // Cost Explorer's latest day is usually incomplete; MTD uses data through yesterday for comparisons.
  const completeThrough = new Date(today.getTime() - DAY);
  const elapsed = Math.max(0, Math.round((completeThrough.getTime() - monthStart.getTime()) / DAY) + 1);
  const prevSamePeriodEnd = new Date(Math.min(prevEnd.getTime(), prevStart.getTime() + (elapsed - 1) * DAY));

  const [mtd, mtdComplete, prev, prevSame] = await Promise.all([
    sumOver(s, monthStart, today, region),
    elapsed > 0 ? sumOver(s, monthStart, completeThrough, region) : Promise.resolve({ amount: 0, estimated: false, days: 0 }),
    sumOver(s, prevStart, prevEnd, region),
    elapsed > 0 ? sumOver(s, prevStart, prevSamePeriodEnd, region) : Promise.resolve({ amount: 0, estimated: false, days: 0 }),
  ]);
  return {
    monthToDate: mtd.amount,
    monthToDateHasData: mtd.days > 0,
    monthToDateEstimated: mtd.estimated,
    previousMonth: prev.amount,
    previousMonthEstimated: prev.estimated,
    previousMonthSamePeriod: prevSame.amount,
    changePct: mtdComplete.days > 0 && prevSame.days > 0 ? percentChange(mtdComplete.amount, prevSame.amount) : null,
    comparedDays: elapsed,
    projection: projectMonthEnd(mtdComplete.amount, mtdComplete.days, now),
    projectionBasisDays: mtdComplete.days,
    hasData: mtd.days + prev.days > 0,
  };
}

export async function getCostOverview(access: OrgAccess, params: CostParams, now = new Date()) {
  assertCan(access, "cost:read");
  const s: Scope = { organizationId: access.organizationId, accountRefIds: params.account ? [params.account] : undefined };
  return cached(access.organizationId, "cost-overview", [params.range, params.from, params.to, params.account, params.region, params.currency, utcDay(now).toISOString()], 60_000, async () => {
    const { start, end } = resolveRange(params.range, now, params.from && params.to ? { from: params.from, to: params.to } : undefined);
    const db = getDb();
    const units = await db.costRecord.groupBy({ by: ["unit"], where: {
      organizationId: access.organizationId, awsAccount: { costScopeVersion: 1 },
      ...(params.account ? { awsAccountRefId: params.account } : {}),
      ...(params.region ? { dimension: "REGION", dimensionKey: params.region } : {}),
    }, orderBy: { unit: "asc" } });
    const currencies = units.map((u) => u.unit);
    // Never sum different currencies. A selected currency isolates every amount and chart.
    const currency = params.currency ?? currencies[0] ?? null;
    s.currency = currency ?? "XXX";
    const dailyWhere = params.region ? baseWhere(s, "DAILY", "REGION", start, end, params.region) : baseWhere(s, "DAILY", "TOTAL", start, end);
    const monthlyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const monthlyWhere = params.region ? baseWhere(s, "MONTHLY", "REGION", monthlyStart, now, params.region) : baseWhere(s, "MONTHLY", "TOTAL", monthlyStart, now);
    // PostgreSQL has no max(boolean); estimated periods are fetched as their own set.
    const estimatedPeriods = async (where: Prisma.CostRecordWhereInput) =>
      new Set((await db.costRecord.groupBy({ by: ["periodStart"], where: { ...where, estimated: true } })).map((r) => r.periodStart.getTime()));
    const [cov, sum, dailyRows, monthlyRows, services, regions, accountRows, momRows, accounts, dailyEst, monthlyEst] = await Promise.all([
      coverage(access.organizationId, s.accountRefIds),
      summary(s, now, params.region),
      db.costRecord.groupBy({ by: ["periodStart"], where: dailyWhere, _sum: { amount: true }, orderBy: { periodStart: "asc" } }),
      db.costRecord.groupBy({ by: ["periodStart"], where: monthlyWhere, _sum: { amount: true }, orderBy: { periodStart: "asc" } }),
      groupSum(s, "SERVICE", start, end),
      groupSum(s, "REGION", start, end),
      db.costRecord.groupBy({ by: ["awsAccountRefId"], where: dailyWhere, _sum: { amount: true } }),
      db.costRecord.groupBy({
        by: ["dimensionKey", "periodStart"],
        where: baseWhere(s, "MONTHLY", "SERVICE", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), now),
        _sum: { amount: true },
      }),
      listAccounts(access.organizationId),
      estimatedPeriods(dailyWhere),
      estimatedPeriods(monthlyWhere),
    ]);

    const names = new Map(accounts.map((a) => [a.id, a.displayName]));
    const thisMonthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
    const mom = new Map<string, { thisMonth: number; lastMonth: number }>();
    for (const r of momRows) {
      const e = mom.get(r.dimensionKey) ?? { thisMonth: 0, lastMonth: 0 };
      if (r.periodStart.getTime() >= thisMonthKey) e.thisMonth += num(r._sum.amount);
      else e.lastMonth += num(r._sum.amount);
      mom.set(r.dimensionKey, e);
    }

    return {
      range: { preset: params.range, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
      coverage: cov,
      currency,
      currencies,
      summary: sum,
      daily: fillDays(
        dailyRows.map((r) => ({ day: r.periodStart.toISOString().slice(0, 10), amount: num(r._sum.amount), estimated: dailyEst.has(r.periodStart.getTime()) })),
        start,
        end,
      ),
      monthly: monthlyRows.map((r) => ({ month: r.periodStart.toISOString().slice(0, 7), amount: num(r._sum.amount), estimated: monthlyEst.has(r.periodStart.getTime()) })),
      byService: topNWithOther(services, 8),
      serviceBreakdownRegionFiltered: false,
      byRegion: topNWithOther(params.region ? regions.filter((r) => r.key === params.region) : regions, 8),
      byAccount: accountRows.map((r) => ({ key: names.get(r.awsAccountRefId) ?? "Unknown account", amount: num(r._sum.amount) })).sort((a, b) => b.amount - a.amount),
      serviceMonthOverMonth: [...mom.entries()]
        .map(([service, v]) => ({ service, thisMonth: v.thisMonth, lastMonth: v.lastMonth, changePct: percentChange(v.thisMonth, v.lastMonth) }))
        .sort((a, b) => b.thisMonth - a.thisMonth),
      estimatedPeriods: dailyEst.size > 0,
    };
  });
}
export type CostOverview = Awaited<ReturnType<typeof getCostOverview>>;
