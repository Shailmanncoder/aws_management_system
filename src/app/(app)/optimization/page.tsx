import { SectionActions } from "@/app/(app)/_components/section-actions";
import { Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatTile } from "@/components/charts/stat-tile";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { BasisBadge, ConfidenceBadge } from "@/components/findings/basis-badges";
import { formatCurrency, formatRelative } from "@/lib/format";
import { resourceHref } from "@/lib/resource-links";
import { CONFIDENCES, DATA_BASES, listOptimizationFindings, OPT_CATEGORIES } from "@/server/services/optimization-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Optimization" };
const opts = (v: readonly string[]) => v.map((x) => ({ value: x, label: x.charAt(0) + x.slice(1).toLowerCase() }));

export default async function OptimizationPage({ searchParams }: PageProps<"/optimization">) {
  const { access } = await getPageAccess("optimization:read");
  if (!access) return <NoAccess what="optimisation recommendations" />;
  const raw = await searchParams;
  const data = await listOptimizationFindings(access, raw);
  const query = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Optimization"
        description="Recommendations from inventory, 14-day CloudWatch utilisation and public AWS list prices. Nothing is changed in AWS; validate heuristics before acting."
        actions={<SectionActions access={access} account={raw.account} label="Re-analyse">{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="optimization" query={query} /> : null}</SectionActions>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open recommendations" icon={Lightbulb} value={data.total} sub={Object.entries(data.byCategory).map(([k, v]) => `${v} ${k}`).join(" · ")} />
        <StatTile label="Estimated monthly savings" value={data.withEstimate ? formatCurrency(data.estimatedSavings, "USD") : "—"} sub={data.withEstimate ? `From ${data.withEstimate} recommendation(s) with price data · list prices, before discounts` : "No recommendation has enough price data"} />
      </div>
      <FilterBar tagFilter={false} searchPlaceholder="Search recommendations…" facets={[
        { param: "category", label: "Category", options: opts(OPT_CATEGORIES) },
        { param: "basis", label: "Data basis", options: opts(DATA_BASES) },
        { param: "confidence", label: "Confidence", options: opts(CONFIDENCES) },
        { param: "status", label: "Status (default: open)", options: opts(["OPEN", "SUPPRESSED", "RESOLVED"]) },
      ]} />
      {data.items.length === 0 ? (
        <EmptyState title="No recommendations" description="Recommendations appear after an inventory sync completes. Missing permissions (CloudWatch, Price List) reduce coverage." />
      ) : (
        <ul className="space-y-3">
          {data.items.map((f) => (
            <li key={f.id} className="space-y-2 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <BasisBadge basis={f.dataBasis} /> <ConfidenceBadge confidence={f.confidence} />
                <span className="text-muted-foreground">{f.category} · {f.awsAccount.displayName} · {f.region} · seen {formatRelative(f.lastSeenAt)}</span>
                {f.estimatedMonthlySavings && <span className="ml-auto font-semibold text-success-text">≈ {formatCurrency(Number(f.estimatedMonthlySavings), f.savingsCurrency ?? "USD")}/mo</span>}
              </div>
              <h2 className="font-medium"><Link href={`/optimization/${f.id}`} className="hover:underline">{f.title}</Link></h2>
              <p className="text-sm text-muted-foreground">{f.reason}</p>
              <p className="text-sm"><strong>Recommended:</strong> {f.recommendation}</p>
              {f.resource && <Link className="text-xs text-primary hover:underline" href={resourceHref(f.resource.resourceType, f.resource.id, f.resource.resourceId)}>View resource →</Link>}
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname="/optimization" params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
    </div>
  );
}
