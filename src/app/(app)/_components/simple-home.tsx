import { logger } from "@/server/logging/logger";
import Link from "next/link";
import { ArrowRight, Wallet, ShieldCheck, FolderHeart, GraduationCap } from "lucide-react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { CoverageBanner } from "@/components/cost/coverage-banner";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { OrgAccess } from "@/server/authz/guard";
import { getCostOverview, parseCostParams } from "@/server/services/cost-service";
import { getSecuritySummary, type Scope } from "@/server/services/dashboard-service";
import { getPriorities } from "@/server/services/simple-service";
import { Priorities } from "@/components/simple/priorities";
import { Explain } from "@/components/simple/explain";
import { CurrencyPicker } from "@/components/cost/currency-picker";
export async function SimpleHome({ access, scope, name, currency }: { access: OrgAccess; scope: Scope; name: string; currency?: string }) {
  const [priorityResult, costResult, securityResult] = await Promise.allSettled([
    getPriorities(access, scope),
    access.can("cost:read") ? getCostOverview(access, parseCostParams({ ...scope, currency })) : null,
    access.can("security:read") ? getSecuritySummary(access, scope) : null,
  ]);
  const priorities = priorityResult.status === "fulfilled" ? priorityResult.value : null;
  const cost = costResult.status === "fulfilled" ? costResult.value : null;
  const security = securityResult.status === "fulfilled" ? securityResult.value : null;
  for (const result of [priorityResult, costResult, securityResult]) if (result.status === "rejected") logger.error("simple dashboard section unavailable", { err: result.reason });
  return <div className="mx-auto max-w-6xl space-y-7">
    <section className="cloud-hero relative overflow-hidden rounded-2xl p-6 text-white shadow-lg shadow-indigo-950/10 sm:p-9"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">{name} · Your cloud workspace</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your cloud, made clearer.</h1><p className="mt-4 max-w-xl leading-relaxed text-indigo-100">See what you are spending, what needs attention, and the next step to take.</p><p className="mt-6 text-xs text-indigo-200">{priorities?.lastChecked ? `Oldest available account refresh: ${formatDateTime(priorities?.lastChecked)}. Some checks update separately.` : "Waiting for the first account refresh."}</p></section>
    {priorities && !priorities.accounts.length && <Card><CardHeader><CardTitle>Connect an AWS account to get started</CardTitle></CardHeader><CardContent><p className="mb-3 text-sm text-muted-foreground">Connect an account so Stratus can show its resources and spending. The connection guide explains each step.</p>{access.can("aws_accounts:connect") ? <Link href="/settings/cloud-accounts/connect" className="font-medium text-primary underline">Connect AWS</Link> : <p>Ask a workspace administrator to connect an account.</p>}</CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2">
      {cost && <Card className="border-t-4 border-t-indigo-500"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-8 rounded-lg bg-indigo-500/10 p-1.5 text-primary" /> Spending this month</CardTitle></CardHeader><CardContent className="space-y-3"><CurrencyPicker currencies={cost.currencies} selected={cost.currency} pathname="/" params={{ ...scope, currency }} /><p className="text-3xl font-semibold">{cost.summary.monthToDateHasData ? formatCurrency(cost.summary.monthToDate, cost.currency) : "Waiting for data"}</p><p className="text-sm text-muted-foreground">{cost.summary.projection === null ? "More daily data is needed for a month-end estimate." : `Estimated month-end: ${formatCurrency(cost.summary.projection, cost.currency)}`}</p><Link className="text-sm font-medium text-primary underline" href="/budget">Plan your budget</Link><Explain><p>This is the usage spending AWS reported for the selected accounts and currency. It may be estimated and can arrive late. Final invoices can include taxes, credits, or a different payment currency.</p></Explain></CardContent></Card>}
      {security && <Card className="border-t-4 border-t-teal-500"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-8 rounded-lg bg-teal-500/10 p-1.5 text-teal-700 dark:text-teal-300" /> Security checks</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-3xl font-semibold">{security.total} open {security.total === 1 ? "issue" : "issues"}</p><p className="text-sm text-muted-foreground">{security.coverageMessage}</p><Link className="text-sm font-medium text-primary underline" href="/security">Review security checks</Link><Explain><p>A finding flags a setting that deserves review. It does not by itself mean an attack happened. No findings does not guarantee everything is safe, especially when checks are missing or stale.</p></Explain></CardContent></Card>}
    </div>
    {cost && <CoverageBanner coverage={cost.coverage} />}
    {priorityResult.status === "rejected" ? <p role="alert" className="rounded-xl border p-5">Your action list is temporarily unavailable. Refresh this page to try again.</p> : priorities && <Priorities actions={priorities.actions} />}
    {costResult.status === "rejected" && <p role="alert" className="rounded-xl border p-5">Spending information is temporarily unavailable. Try opening Spending again shortly.</p>}
    {securityResult.status === "rejected" && <p role="alert" className="rounded-xl border p-5">Security checks could not be loaded. This does not mean there are no issues.</p>}
    <section className="grid gap-3 sm:grid-cols-3">{[
      { href: "/projects", title: "Organize by project", text: "Group accounts under your website, store, or test environment.", icon: FolderHeart, show: true },
      { href: "/start", title: "Start with a goal", text: "Store files, run an application, or set up a database.", icon: GraduationCap, show: access.can("inventory:read") },
      { href: "/weekly", title: "Your weekly summary", text: "Catch up on spending, new issues, and completed team requests.", icon: ArrowRight, show: true },
    ].filter(x => x.show).map(x => <Link key={x.href} href={x.href} className="group rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/50"><x.icon className="mb-4 size-10 rounded-xl bg-primary/10 p-2.5 text-primary" /><h2 className="font-semibold">{x.title}</h2><p className="mt-2 text-sm text-muted-foreground">{x.text}</p></Link>)}</section>
  </div>;
}
