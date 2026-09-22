import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertActions } from "@/components/alerts/alert-actions";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { SeverityBadge, type SeverityValue } from "@/components/findings/severity";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { listAlerts } from "@/server/services/alert-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const { access } = await getPageAccess("alerts:read");
  if (!access) return <NoAccess what="alerts" />;
  const raw = await searchParams;
  const data = await listAlerts(access, raw);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        description="Raised automatically after each sync. Updates live."
        actions={<SectionActions access={access} label="Re-evaluate">{access.can("alerts:manage") ? <Button asChild variant="outline" size="sm"><Link href="/settings/alerts">Manage rules</Link></Button> : null}</SectionActions>}
      />
      <FilterBar tagFilter={false} facets={[{ param: "status", label: "Status (default: open + acknowledged)", options: ["OPEN", "ACKNOWLEDGED", "RESOLVED"].map((v) => ({ value: v, label: v.toLowerCase() })) }]} />
      {data.items.length === 0 ? (
        <EmptyState title="No alerts" description="Nothing needs attention. Alerts appear here when enabled rules match after a sync." />
      ) : (
        <ul className="space-y-2">
          {data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
              <SeverityBadge severity={a.severity as SeverityValue} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.title}</p>
                <p className="text-sm text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground">
                  {a.rule?.name ?? a.type} · {a.awsAccount?.displayName ?? "workspace"} · {formatRelative(a.createdAt)} · {a.status.toLowerCase()}
                </p>
              </div>
              {access.can("alerts:acknowledge") && <AlertActions orgId={access.organizationId} alertId={a.id} status={a.status} />}
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname="/alerts" params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
    </div>
  );
}
