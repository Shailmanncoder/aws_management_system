import { Boxes, Cloud, Container, Database, Globe, HardDrive, Lightbulb, Receipt, Server, ShieldAlert, TrendingUp, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/components/charts/bar-list";
import { StatTile } from "@/components/charts/stat-tile";
import { RefreshNow } from "@/components/aws/refresh-now";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { InvoicePanel } from "@/app/(app)/_components/invoice-panel";
import { CurrencyPicker } from "@/components/cost/currency-picker";
import { CostCharts } from "@/components/cost/cost-charts";
import { CoverageBanner } from "@/components/cost/coverage-banner";
import { RangePicker } from "@/components/cost/range-picker";
import { SEVERITY_ORDER, severityColor, severityLabel, type SeverityValue } from "@/components/findings/severity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/format";
import { RESOURCE_TYPE_LABELS, type ResourceType } from "@/lib/resource-types";
import type { OrgAccess } from "@/server/authz/guard";
import { logger } from "@/server/logging/logger";
import { getCostOverview, parseCostParams, type CostParams } from "@/server/services/cost-service";
import { getInventorySummary, getOptimizationSummary, getSecuritySummary, type Scope } from "@/server/services/dashboard-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

/** Each section loads independently; a failure renders an error card instead of breaking the page. */
async function guarded(name: string, render: () => Promise<React.ReactNode>): Promise<React.ReactNode> {
  try {
    return await render();
  } catch (err) {
    logger.error("dashboard section failed", { section: name, err });
    return <ErrorState title={`${name} unavailable`} description="This section could not be loaded. Other sections are unaffected." />;
  }
}

function TilesSkeleton({ n }: { n: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { ctx, access } = await getPageAccess("org:read");
  const raw = await searchParams;
  const scope: Scope = {
    account: isUuid(raw.account) ? raw.account : undefined,
    region: typeof raw.region === "string" && /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(raw.region) ? raw.region : undefined,
  };
  const costParams = parseCostParams(raw);
  if (!access) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${ctx.org.name} — inventory, spend, security posture and optimisation across connected AWS accounts.`}
        actions={
          <>
            {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} label="Refresh all" />}
            {access.can("cost:read") && (
              <Suspense fallback={<Skeleton className="h-8 w-44" />}>
                <RangePicker />
              </Suspense>
            )}
          </>
        }
      />
      {access.can("inventory:read") && (
        <Suspense fallback={<TilesSkeleton n={10} />}>
          <InventorySection access={access} scope={scope} />
        </Suspense>
      )}
      {access.can("cost:read") && (
        <Suspense fallback={<TilesSkeleton n={4} />}>
          <CostSection access={access} params={{ ...costParams, account: scope.account, region: scope.region }} />
        </Suspense>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {access.can("security:read") && (
          <Suspense fallback={<Skeleton className="h-64" />}>
            <SecuritySection access={access} scope={scope} />
          </Suspense>
        )}
        {access.can("optimization:read") && (
          <Suspense fallback={<Skeleton className="h-64" />}>
            <OptimizationSection access={access} scope={scope} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function InventorySection({ access, scope }: { access: OrgAccess; scope: Scope }) {
  return guarded("Inventory", async () => {
    const inv = await getInventorySummary(access, scope);
    if (inv.accounts === 0) {
      return (
        <EmptyState
          icon={Cloud}
          title="Connect your first AWS account"
          description="Stratus uses a read-only IAM role with a unique ExternalId. No long-term keys, no root credentials."
          action={
            access.can("aws_accounts:connect") ? (
              <Button asChild>
                <Link href="/settings/cloud-accounts/connect">Connect AWS</Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Ask a workspace admin to connect an account.</p>
            )
          }
        />
      );
    }
    const typeItems = (Object.entries(inv.byType) as [ResourceType, number][]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return (
      <div className="space-y-4">
        {inv.syncIssues.length > 0 && (
          <ErrorState
            title="Some AWS accounts synchronised partially or failed"
            description={
              <ul>
                {inv.syncIssues.map((s) => (
                  <li key={s.id}>
                    <Link className="underline" href={`/settings/cloud-accounts/${s.id}`}>
                      {s.name}
                    </Link>
                    : {s.error ?? s.status}
                  </li>
                ))}
              </ul>
            }
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatTile label="AWS accounts" icon={Cloud} value={inv.accounts} sub={`${inv.connectedAccounts} connected`} />
          <StatTile label="Resources" icon={Boxes} value={formatNumber(inv.resources)} sub={inv.neverSynced ? `${inv.neverSynced} account(s) syncing` : undefined} />
          <StatTile label="Regions in use" icon={Globe} value={inv.regions} />
          <StatTile label="EC2 instances" icon={Server} value={inv.ec2} sub={inv.ec2States.map((s) => `${s.count} ${s.state}`).join(" · ")} />
          <StatTile label="S3 buckets" icon={HardDrive} value={inv.s3} />
          <StatTile label="Databases" icon={Database} value={inv.databases} sub="RDS, Aurora, DynamoDB" />
          <StatTile label="Lambda functions" icon={Zap} value={inv.lambda} />
          <StatTile label="Containers" icon={Container} value={inv.containers} sub="ECS, EKS, ECR" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                Resource distribution
                {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} accountId={scope.account} size="xs" className="ml-auto" label="Refresh inventory" />}
              </CardTitle>
              <CardDescription className="text-xs">Top resource types in scope</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList ariaLabel="Resources by type" items={typeItems.map(([t, n]) => ({ label: RESOURCE_TYPE_LABELS[t] ?? t, value: n, display: formatNumber(n), href: `/resources?type=${encodeURIComponent(t)}` }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">EC2 instance status</CardTitle>
              <CardDescription className="text-xs">From the latest inventory sync</CardDescription>
            </CardHeader>
            <CardContent>
              {inv.ec2States.length === 0 ? (
                <p className="text-sm text-muted-foreground">No EC2 instances in scope.</p>
              ) : (
                <BarList ariaLabel="EC2 instances by state" items={inv.ec2States.map((s) => ({ label: s.state, value: s.count, display: String(s.count), href: `/cloud/ec2?state=${encodeURIComponent(s.state)}` }))} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  });
}

async function CostSection({ access, params }: { access: OrgAccess; params: CostParams }) {
  return guarded("Cost", async () => {
    const data = await getCostOverview(access, params);
    const s = data.summary;
    const money = (n: number) => formatCurrency(n, data.currency);
    return (
      <section aria-labelledby="cost-heading" className="space-y-4">
        <h2 id="cost-heading" className="flex items-center gap-2 text-sm font-medium">
          <Receipt className="size-4" aria-hidden /> Spend
          {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} type="COST_SYNC" accountId={params.account} size="xs" className="ml-auto" />}
          <Link href="/cost" className={`${access.can("sync:trigger") ? "" : "ml-auto "}text-xs font-normal text-primary hover:underline`}>
            Open Cost Explorer →
          </Link>
        </h2>
        <CoverageBanner coverage={data.coverage} />
        <InvoicePanel access={access} account={params.account} compact />
        <CurrencyPicker currencies={data.currencies} selected={data.currency} pathname="/" params={params} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Current month spend" icon={Wallet} value={s.hasData ? money(s.monthToDate) : "—"} badge={s.monthToDateEstimated ? <span className="rounded bg-muted px-1.5 py-0.5">Estimated</span> : undefined} />
          <StatTile label="Previous month spend" icon={Receipt} value={s.hasData ? money(s.previousMonth) : "—"} />
          <StatTile label="Cost change" icon={TrendingUp} value={s.changePct === null ? "—" : `${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%`} sub={`vs first ${s.comparedDays} day(s) of last month`} />
          <StatTile label="Estimated monthly cost" icon={TrendingUp} value={s.projection === null ? "—" : money(s.projection)} sub="Linear projection, not a bill" />
        </div>
        <CostCharts
          compact
          data={{
            currency: data.currency,
            daily: data.daily,
            monthly: data.monthly,
            byService: data.byService,
            byRegion: data.byRegion,
            byAccount: data.byAccount,
            hasData: data.coverage.some((c) => c.status === "available"),
            regionFiltered: Boolean(params.region),
          }}
        />
      </section>
    );
  });
}

async function SecuritySection({ access, scope }: { access: OrgAccess; scope: Scope }) {
  return guarded("Security findings", async () => {
    const sec = await getSecuritySummary(access, scope);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="size-4" aria-hidden /> Security findings by severity
            {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} accountId={scope.account} size="xs" className="ml-auto" label="Rescan" />}
          </CardTitle>
          <CardDescription className="text-xs">{sec.total} recorded open finding(s) · {sec.coverageMessage}</CardDescription>
        </CardHeader>
        <CardContent>
          {sec.total === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded open findings. This does not mean all resources were assessed; review scan coverage in Security Center.</p>
          ) : (
            <BarList
              ariaLabel="Open security findings by severity"
              items={SEVERITY_ORDER.map((sv: SeverityValue) => ({
                label: severityLabel(sv),
                value: sec.bySeverity[sv] ?? 0,
                display: String(sec.bySeverity[sv] ?? 0),
                color: severityColor(sv),
                href: `/security?severity=${sv}`,
              }))}
            />
          )}
        </CardContent>
      </Card>
    );
  });
}

async function OptimizationSection({ access, scope }: { access: OrgAccess; scope: Scope }) {
  return guarded("Optimisation", async () => {
    const opt = await getOptimizationSummary(access, scope);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="size-4" aria-hidden /> Optimisation opportunities
            {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} accountId={scope.account} size="xs" className="ml-auto" label="Re-analyse" />}
          </CardTitle>
          <CardDescription className="text-xs">Heuristic recommendations require validation before action.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-2xl font-semibold">{opt.total}</p>
          <p className="text-muted-foreground">
            {opt.withSavingsEstimate > 0
              ? `${formatCurrency(opt.estimatedMonthlySavings, "USD")}/month estimated (public list prices) across ${opt.withSavingsEstimate} recommendation(s).`
              : "No recommendation currently has enough price and usage data for a savings estimate."}
          </p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {Object.entries(opt.byBasis).map(([k, v]) => (
              <li key={k} className="rounded bg-muted px-2 py-1">
                {k.toLowerCase()}: {v}
              </li>
            ))}
          </ul>
          <Link href="/optimization" className="text-xs text-primary hover:underline">
            Review recommendations →
          </Link>
        </CardContent>
      </Card>
    );
  });
}
