import { SectionActions } from "@/app/(app)/_components/section-actions";
import { ArrowDownRight, ArrowUpRight, CalendarRange, Receipt, TrendingUp, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState, NoAccess } from "@/components/common/states";
import { InvoicePanel } from "@/app/(app)/_components/invoice-panel";
import { CurrencyPicker } from "@/components/cost/currency-picker";
import { CostCharts } from "@/components/cost/cost-charts";
import { CoverageBanner } from "@/components/cost/coverage-banner";
import { RangePicker } from "@/components/cost/range-picker";
import { StatTile } from "@/components/charts/stat-tile";
import { TableShell } from "@/components/resource/table-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { logger } from "@/server/logging/logger";
import { getCostOverview, parseCostParams, type CostOverview } from "@/server/services/cost-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Cost Explorer" };

export default async function CostPage({ searchParams }: PageProps<"/cost">) {
  const { access } = await getPageAccess("cost:read");
  if (!access) return <NoAccess what="cost data" />;
  const raw = await searchParams;
  const params = parseCostParams(raw);
  let data: CostOverview;
  try {
    data = await getCostOverview(access, params);
  } catch (err) {
    logger.error("cost overview failed", { err });
    return (
      <>
        <PageHeader title="Cost Explorer" />
        <ErrorState title="Cost data could not be loaded" description="Please retry. If the problem persists, contact support with the time of the error." />
      </>
    );
  }
  const s = data.summary;
  const currency = data.currency;
  const money = (n: number) => formatCurrency(n, currency);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cost Explorer"
        description={`AWS-reported unblended cost from Cost Explorer, synchronised twice daily. ${data.range.start} → ${data.range.end}.`}
        actions={
          <>
            <SectionActions access={access} type="COST_SYNC" account={params.account} />
            <Suspense fallback={<Skeleton className="h-8 w-44" />}>
              <RangePicker />
            </Suspense>
            {access.can("reports:export") && <ExportButton orgId={access.organizationId} report="cost" query={{ range: params.range, from: params.from, to: params.to, account: params.account, region: params.region, currency: params.currency }} />}
          </>
        }
      />
      <CoverageBanner coverage={data.coverage} />
      <InvoicePanel access={access} account={params.account} />
      <CurrencyPicker currencies={data.currencies} selected={data.currency} pathname="/cost" params={raw} />
      <p className="text-xs text-muted-foreground">Usage analytics below use {data.currency ?? "the currency reported by Cost Explorer"}. Invoice payment amounts above can use a different currency. No currency conversion is applied.</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Current month to date"
          icon={Wallet}
          value={s.hasData ? money(s.monthToDate) : "—"}
          badge={s.monthToDateEstimated ? <span className="rounded bg-muted px-1.5 py-0.5">Estimated</span> : undefined}
        />
        <StatTile label="Previous month" icon={Receipt} value={s.hasData ? money(s.previousMonth) : "—"} sub={s.previousMonthEstimated ? "includes estimated days" : "final"} />
        <StatTile
          label="Change vs same period last month"
          icon={s.changePct !== null && s.changePct > 0 ? ArrowUpRight : ArrowDownRight}
          value={s.changePct === null ? "—" : `${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}
          sub={s.changePct === null ? "Not enough data to compare" : `first ${s.comparedDays} day(s): ${money(s.previousMonthSamePeriod)} last month`}
        />
        <StatTile
          label="Projected month-end"
          icon={TrendingUp}
          value={s.projection === null ? "—" : money(s.projection)}
          sub={s.projection === null ? "Needs ≥3 complete days this month" : `Linear projection from ${s.projectionBasisDays} complete day(s) — an estimate, not a bill`}
        />
      </div>

      <CostCharts
        data={{
          currency: data.currency,
          daily: data.daily,
          monthly: data.monthly,
          byService: data.byService,
          byRegion: data.byRegion,
          byAccount: data.byAccount,
          hasData: data.coverage.some((c) => c.status === "available") || data.daily.some((d) => d.amount !== null),
          regionFiltered: Boolean(params.region),
        }}
      />

      <section aria-labelledby="mom-heading" className="space-y-2">
        <h2 id="mom-heading" className="flex items-center gap-2 text-sm font-medium">
          <CalendarRange className="size-4" aria-hidden /> Month-over-month by service
        </h2>
        {data.serviceMonthOverMonth.length === 0 ? (
          <p className="text-sm text-muted-foreground">No monthly service data available.</p>
        ) : (
          <TableShell caption="Month-over-month spend by service">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Service</TableHead>
                  <TableHead scope="col" className="text-right">This month (MTD, estimated)</TableHead>
                  <TableHead scope="col" className="text-right">Last month</TableHead>
                  <TableHead scope="col" className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.serviceMonthOverMonth.map((r) => (
                  <TableRow key={r.service}>
                    <TableCell>{r.service}</TableCell>
                    <TableCell className="tabular text-right">{money(r.thisMonth)}</TableCell>
                    <TableCell className="tabular text-right">{money(r.lastMonth)}</TableCell>
                    <TableCell className="tabular text-right text-xs">
                      {r.changePct === null ? "—" : `${r.changePct > 0 ? "+" : ""}${r.changePct.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
        <p className="text-xs text-muted-foreground">Service comparisons cover all regions. MTD values are partial-month and will usually be lower than full prior months; compare with care.</p>
      </section>
    </div>
  );
}
