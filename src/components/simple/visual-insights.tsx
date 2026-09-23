"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, ArrowUpRight } from "lucide-react";
import { ColumnChart } from "@/components/charts/column-chart";
import { ChartCard } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEVERITY_ORDER, severityColor, severityLabel } from "@/components/findings/severity";
import { formatCurrency, formatNumber } from "@/lib/format";

interface InsightsProps {
  cost: { daily: { day: string; amount: number | null; estimated: boolean }[]; currency: string | null } | null;
  security: { bySeverity: Record<string, number>; total: number; coverageMessage: string } | null;
  inventory: { resources: number; regions: number; ec2: number; s3: number; databases: number; lambda: number; containers: number } | null;
  scope: { account?: string; region?: string };
}

export function VisualInsights({ cost, security, inventory, scope }: InsightsProps) {
  const [days, setDays] = useState(30);
  const daily = cost?.daily.slice(-days) ?? [];
  const available = daily.filter(d => d.amount !== null);
  const total = available.reduce((sum, d) => sum + d.amount!, 0);
  const money = (value: number, compact = false) => formatCurrency(value, cost?.currency ?? null, { compact });
  const link = (path: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...(scope.account ? { account: scope.account } : {}), ...(scope.region ? { region: scope.region } : {}), ...extra });
    return `${path}${params.size ? `?${params}` : ""}`;
  };
  const resources = inventory ? [
    { label: "Servers", value: inventory.ec2, href: link("/cloud/ec2") },
    { label: "File storage", value: inventory.s3, href: link("/cloud/s3") },
    { label: "Databases", value: inventory.databases, href: link("/cloud/databases") },
    { label: "Functions", value: inventory.lambda, href: link("/cloud/serverless") },
    { label: "Containers & registries", value: inventory.containers, href: link("/cloud/containers") },
    { label: "Other resources", value: Math.max(0, inventory.resources - inventory.ec2 - inventory.s3 - inventory.databases - inventory.lambda - inventory.containers), href: link("/resources") },
  ].sort((a, b) => b.value - a.value) : [];
  const segments = security ? SEVERITY_ORDER.map(key => ({ key, label: severityLabel(key), count: security.bySeverity[key] ?? 0, color: severityColor(key) })) : [];
  let offset = 0;
  const gradient = segments.map(s => { const start = offset; offset += security?.total ? s.count / security.total * 100 : 0; return `${s.color} ${start}% ${offset}%`; }).join(", ");

  function download() {
    const csv = ["Date,Amount,Currency,Status", ...daily.map(d => `${d.day},${d.amount ?? ""},${cost?.currency ?? ""},${d.amount === null ? "Missing" : d.estimated ? "Estimated" : "Reported"}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `spending-${days}-days.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section aria-label="Workspace insights" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">At a glance</p><h2 className="mt-1 text-xl font-semibold tracking-tight">The bigger picture</h2></div><p className="text-xs text-muted-foreground">Your selected workspace, accounts and regions</p></div>
    {cost && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border p-1" role="group" aria-label="Spending period">{[7, 30].map(n => <Button key={n} size="sm" variant={days === n ? "secondary" : "ghost"} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</Button>)}</div>
        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" disabled={!available.length} onClick={download}><Download className="size-4" /> Download CSV</Button><Link href={link("/cost", cost.currency ? { currency: cost.currency } : {})} className="inline-flex items-center gap-1 text-xs text-primary">Explore spending <ArrowUpRight className="size-3.5" /></Link></div>
      </div>
      <ChartCard title="Spending trend" description={`${available.length ? money(total) : "No reported spend"} across ${available.length} reported days · Missing days are gaps; hatched bars are estimates.`}
        state={available.length ? { kind: "ready" } : { kind: "empty", message: "Your spending chart will appear after AWS billing data is available." }} height={230}
        summary={`${money(total)} reported over the last ${days} days. ${daily.length - available.length} days have no data.`}
        table={<table className="w-full text-left text-xs"><caption className="sr-only">Spending trend data</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead><tbody>{daily.map(d => <tr key={d.day} className="border-t"><td className="py-2">{d.day}</td><td>{d.amount === null ? "Unavailable" : money(d.amount)}</td><td>{d.amount === null ? "Missing" : d.estimated ? "Estimated" : "Reported"}</td></tr>)}</tbody></table>}>
        <ColumnChart data={daily.map(d => ({ x: d.day, y: d.amount, estimated: d.estimated }))} unit="count" label="Daily spending" formatY={money} formatX={day => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} />
      </ChartCard>
    </div>}
    <div className="grid gap-4 xl:grid-cols-2">
      {security && <Card><CardHeader><CardTitle>Security at a glance</CardTitle><p className="text-xs text-muted-foreground">Open findings by severity · {security.coverageMessage}</p></CardHeader><CardContent className="flex flex-wrap items-center gap-6">
        <div role="img" aria-label={`${security.total} open security findings. ${segments.map(s => `${s.count} ${s.label}`).join(", ")}.`} className="relative mx-auto grid size-36 shrink-0 place-items-center rounded-full" style={{ background: security.total ? `conic-gradient(${gradient})` : "var(--muted)" }}><div className="absolute inset-3 rounded-full bg-card" /><div className="relative text-center"><p className="text-3xl font-semibold tabular-nums">{formatNumber(security.total)}</p><p className="text-xs text-muted-foreground">open findings</p></div></div>
        <ul className="min-w-40 flex-1 space-y-3">{segments.map(s => <li key={s.key}><Link href={link("/security", { severity: s.key })} className="flex items-center justify-between gap-4 text-sm hover:underline"><span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span><span className="tabular-nums">{formatNumber(s.count)}</span></Link></li>)}</ul>
        {!security.total && <p className="w-full text-xs text-muted-foreground">No open findings in the saved data. Check scan coverage before treating this as an all-clear.</p>}
      </CardContent></Card>}
      {inventory && <Card><CardHeader><CardTitle>Your resource mix</CardTitle><p className="text-xs text-muted-foreground">{formatNumber(inventory.resources)} discovered resources across {inventory.regions} regions · Saved inventory</p></CardHeader><CardContent>{inventory.resources ? <BarList ariaLabel="Resources by category" items={resources.map(r => ({ ...r, display: formatNumber(r.value) }))} /> : <p className="py-10 text-center text-sm text-muted-foreground">Connect an account and complete an inventory refresh to see your resource mix.</p>}</CardContent></Card>}
    </div>
  </section>;
}
