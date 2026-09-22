"use client";

import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { formatCurrency } from "@/lib/format";
import { shortService } from "@/lib/cost-math";

export interface CostChartData {
  currency: string | null;
  daily: { day: string; amount: number | null; estimated: boolean }[];
  monthly: { month: string; amount: number; estimated: boolean }[];
  byService: { key: string; amount: number }[];
  byRegion: { key: string; amount: number }[];
  byAccount: { key: string; amount: number }[];
  hasData: boolean;
  regionFiltered: boolean;
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

function MoneyTable({ rows, head, currency }: { currency: string | null; rows: { label: string; value: number; note?: string }[]; head: [string, string] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1">{head[0]}</th>
          <th scope="col" className="py-1 text-right">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t">
            <td className="py-1">
              {r.label}
              {r.note && <span className="text-muted-foreground"> {r.note}</span>}
            </td>
            <td className="tabular py-1 text-right">{formatCurrency(r.value, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const emptyMsg = "No billing data for this scope. Billing may be unavailable for the selected accounts or not yet synchronised.";

export function CostCharts({ data, compact = false }: { data: CostChartData; compact?: boolean }) {
  const fmt = (n: number, compact = false) => formatCurrency(n, data.currency, { compact });
  const dailyTotal = data.daily.reduce((s, d) => s + (d.amount ?? 0), 0);
  const peak = data.daily.reduce((m, d) => (d.amount !== null && d.amount > m.amount ? { day: d.day, amount: d.amount } : m), { day: "", amount: 0 });
  const state = (has: boolean) => (data.hasData && has ? ({ kind: "ready" } as const) : ({ kind: "empty", message: emptyMsg } as const));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        className="lg:col-span-2"
        title="Daily spend"
        description="Unblended cost per day. Hatched bars are estimated (not yet final)."
        state={state(data.daily.some((d) => d.amount !== null))}
        summary={`Total ${fmt(dailyTotal)} over ${data.daily.length} days; highest day ${peak.day ? `${dayLabel(peak.day)} at ${fmt(peak.amount)}` : "n/a"}.`}
        height={compact ? 200 : 260}
        table={<MoneyTable currency={data.currency} head={["Day", "Spend"]} rows={data.daily.filter((d) => d.amount !== null).map((d) => ({ label: d.day, value: d.amount!, note: d.estimated ? "(estimated)" : undefined }))} />}
      >
        <ColumnChart data={data.daily.map((d) => ({ x: d.day, y: d.amount, estimated: d.estimated }))} unit="count" formatY={fmt} label={`Spend (${data.currency ?? "currency unavailable"})`} formatX={dayLabel} />
      </ChartCard>
      <ChartCard
        title="Monthly spend"
        description="Last 12 months. The current month is estimated."
        state={state(data.monthly.length > 0)}
        summary={data.monthly.map((m) => `${monthLabel(m.month)} ${fmt(m.amount)}`).join("; ")}
        table={<MoneyTable currency={data.currency} head={["Month", "Spend"]} rows={data.monthly.map((m) => ({ label: m.month, value: m.amount, note: m.estimated ? "(estimated)" : undefined }))} />}
      >
        <ColumnChart data={data.monthly.map((m) => ({ x: m.month, y: m.amount, estimated: m.estimated }))} unit="count" formatY={fmt} label={`Spend (${data.currency ?? "currency unavailable"})`} formatX={monthLabel} />
      </ChartCard>
      <ChartCard
        title="Spend by service"
        description={data.regionFiltered ? "Top services for the date range (not filtered by region — Cost Explorer data is grouped by one dimension at a time)." : "Top services for the date range."}
        state={state(data.byService.length > 0)}
        summary={data.byService.map((s) => `${shortService(s.key)} ${fmt(s.amount)}`).join("; ")}
        table={<MoneyTable currency={data.currency} head={["Service", "Spend"]} rows={data.byService.map((s) => ({ label: s.key, value: s.amount }))} />}
      >
        <BarList ariaLabel="Spend by service" items={data.byService.map((s) => ({ label: shortService(s.key), value: s.amount, display: fmt(s.amount) }))} />
      </ChartCard>
      <ChartCard
        title="Spend by region"
        state={state(data.byRegion.length > 0)}
        summary={data.byRegion.map((s) => `${s.key} ${fmt(s.amount)}`).join("; ")}
        table={<MoneyTable currency={data.currency} head={["Region", "Spend"]} rows={data.byRegion.map((s) => ({ label: s.key, value: s.amount }))} />}
      >
        <BarList ariaLabel="Spend by region" items={data.byRegion.map((s) => ({ label: s.key, value: s.amount, display: fmt(s.amount) }))} />
      </ChartCard>
      <ChartCard
        title="Spend by AWS account"
        state={state(data.byAccount.length > 0)}
        summary={data.byAccount.map((s) => `${s.key} ${fmt(s.amount)}`).join("; ")}
        table={<MoneyTable currency={data.currency} head={["Account", "Spend"]} rows={data.byAccount.map((s) => ({ label: s.key, value: s.amount }))} />}
      >
        <BarList ariaLabel="Spend by account" items={data.byAccount.map((s) => ({ label: s.key, value: s.amount, display: fmt(s.amount) }))} />
      </ChartCard>
    </div>
  );
}
