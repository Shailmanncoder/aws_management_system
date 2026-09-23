import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BudgetForm } from "@/components/simple/budget-form";
import { Explain } from "@/components/simple/explain";
import { CoverageBanner } from "@/components/cost/coverage-banner";
import { formatCurrency } from "@/lib/format";
import { budgetProgress } from "@/lib/simple";
import { getPageAccess } from "@/server/services/workspace-context";
import { getCostOverview, parseCostParams } from "@/server/services/cost-service";
import { getBudgets } from "@/server/services/simple-service";
export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const { access } = await getPageAccess("cost:read"); if (!access) return <NoAccess what="budgets" />;
  const raw = await searchParams;
  const [cost, budgets] = await Promise.all([getCostOverview(access, parseCostParams({ currency: raw.currency })), getBudgets(access)]);
  const currency = cost.currency ?? budgets[0]?.currency ?? "USD";
  const budget = budgets.find(b => b.currency === currency);
  const amount = cost.summary.monthToDateHasData ? cost.summary.monthToDate : null;
  const state = budget ? budgetProgress(amount, budget.amount, cost.summary.projection) : null;
  const currencies = [...new Set([...cost.currencies, ...budgets.map(b => b.currency)])];
  return <div className="mx-auto max-w-5xl space-y-6">
    <PageHeader title="Budget planner" description="Plan spending for all accounts in this workspace. Account and region filters do not apply to this page." />
    <CoverageBanner coverage={cost.coverage} />
    <div className="flex flex-wrap gap-2">{currencies.map(c => <Link key={c} href={`/budget?currency=${c}`} aria-current={currency === c ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm ${currency === c ? "bg-primary text-primary-foreground" : "bg-card"}`}>{c}</Link>)}</div>
    <div className="grid gap-4 sm:grid-cols-3">
      {[ ["Spent this month", amount === null ? "Not available yet" : formatCurrency(amount, currency)], ["Estimated month-end spend", cost.summary.projection === null ? "Not enough data" : formatCurrency(cost.summary.projection, currency)], ["Monthly budget", budget ? formatCurrency(budget.amount, currency) : "Not set"] ].map(([label,value]) => <Card key={label}><CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{value}</CardContent></Card>)}
    </div>
    {budget && state && <Card><CardHeader><CardTitle className={state.percent !== null && state.percent >= 100 ? "text-destructive" : undefined}>{state.status}</CardTitle></CardHeader><CardContent className="space-y-3">{state.percent !== null && <><div role="progressbar" aria-label="Monthly budget used" aria-valuenow={Math.min(100, Math.round(state.percent))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${Math.round(state.percent)}% used`} className="h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full ${state.percent >= 100 ? "bg-destructive" : state.percent >= budget.warningPercent ? "bg-status-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, state.percent)}%` }} /></div><p>{Math.round(state.percent)}% used · {formatCurrency(Math.abs(state.remaining!), currency)} {state.remaining! < 0 ? "over budget" : "remaining"}</p></>}<p className="text-sm text-muted-foreground">{budget.enabled ? `In-app alerts are enabled at ${budget.warningPercent}% and 100%, checked after spending data refreshes.` : "Budget alerts are disabled. Save this budget to enable them."}</p></CardContent></Card>}
    <Card><CardHeader><CardTitle>{budget ? "Adjust your budget" : "Set a monthly budget"}</CardTitle></CardHeader><CardContent>{access.can("alerts:manage") ? <BudgetForm key={`${currency}:${budget?.amount}:${budget?.warningPercent}`} orgId={access.organizationId} currency={currency} amount={budget?.amount} warningPercent={budget?.warningPercent} /> : <p className="text-sm">Ask a workspace administrator to set or change the budget.</p>}</CardContent></Card>
    <Explain><p>These are AWS usage costs, which can arrive late and may be estimated. Your invoice can use a different payment currency and include taxes or credits.</p><p>Each currency has its own budget. Amounts are never converted or added across currencies. The month-end estimate extends the observed daily spending rate; it is not a guaranteed bill.</p><p>Alerts appear under Alerts in this app. A budget does not stop resources, cap charges, or send email. <Link className="underline" href="/settings/alerts">Manage alert rules</Link>.</p></Explain>
  </div>;
}
