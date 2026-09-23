import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Explain } from "@/components/simple/explain";
import { PrintSummary } from "@/components/simple/print-summary";
import { CoverageBanner } from "@/components/cost/coverage-banner";
import { formatCurrency } from "@/lib/format";
import { getPageAccess } from "@/server/services/workspace-context";
import { weeklySummary } from "@/server/services/simple-service";
import { getCostOverview, parseCostParams } from "@/server/services/cost-service";
import { getSecuritySummary } from "@/server/services/dashboard-service";
export default async function WeeklyPage({ searchParams }: PageProps<"/weekly">) {
  const { access } = await getPageAccess("org:read"); if (!access) return null;
  const raw = await searchParams, parsed = typeof raw.week === "string" ? Number(raw.week) : 1;
  const offset = Number.isInteger(parsed) && parsed >= 0 && parsed <= 12 ? parsed : 1;
  const [summary, cost, security] = await Promise.all([weeklySummary(access, offset), access.can("cost:read") ? getCostOverview(access, parseCostParams({})) : null, access.can("security:read") ? getSecuritySummary(access,{}) : null]);
  return <div className="mx-auto max-w-5xl space-y-6"><PageHeader title="Weekly summary" description={`All workspace AWS accounts · ${summary.start.toISOString().slice(0,10)} to ${summary.end.toISOString().slice(0,10)} (end exclusive, UTC)${offset === 0 ? " · week in progress" : ""}`} actions={<PrintSummary />} />
    <div className="flex flex-wrap items-center gap-3 text-sm print:hidden"><Link className="text-primary underline" href="/weekly?week=0">This week</Link><Link className="text-primary underline" href="/weekly?week=1">Last completed week</Link>{offset < 12 && <Link className="text-primary underline" href={`/weekly?week=${offset+1}`}>Previous week</Link>}{offset > 1 && <Link className="text-primary underline" href={`/weekly?week=${offset-1}`}>Next week</Link>}</div>
    {cost && <><CoverageBanner coverage={cost.coverage} /><section className="space-y-3"><h2 className="text-xl font-semibold">Spending</h2>{!summary.costs.length && <p className="rounded-xl border p-5 text-sm text-muted-foreground">No reported spending data for this week. This does not mean the bill was zero.</p>}<div className="grid gap-3 sm:grid-cols-2">{summary.costs.map(c => <Card key={c.currency}><CardHeader><CardTitle className="text-sm">Usage spending · {c.currency}</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-3xl font-semibold">{formatCurrency(c.amount,c.currency)}</p><p className="text-sm text-muted-foreground">{c.previous === null ? "No previous-week data for comparison." : `${formatCurrency(Math.abs(c.amount-c.previous),c.currency)} ${c.amount >= c.previous ? "more" : "less"} than the comparable period a week earlier.`}</p></CardContent></Card>)}</div></section></>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["New security issues",summary.newIssues],["Security issues resolved",summary.resolvedIssues],["Team requests completed",summary.completed],["Resources first discovered",summary.added],["Resources no longer found",summary.removed]].filter(([,v]) => v !== null).map(([label,value]) => <Card key={String(label)}><CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{value}</CardContent></Card>)}</div>
    {security && <p className="text-sm text-muted-foreground">Current security coverage: {security.coverageMessage}.</p>}
    <Explain><p>This in-app digest is calculated from saved account data whenever you open it. By default it shows the last completed Monday-to-Monday week; you can also view earlier weeks or this week so far.</p><p>Amounts stay separate by currency and may be estimated or incomplete. Comparisons can be affected by missing data or accounts added since the previous week. A newly discovered resource may have existed before Stratus connected.</p><p>Completed help requests record teamwork, not a guarantee that a resource is safe. No email is sent automatically.</p></Explain>
  </div>;
}
