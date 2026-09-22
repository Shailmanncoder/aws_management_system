import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import { getDb } from "@/server/db";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Monitoring" };

/** Fleet utilisation from 14-day CloudWatch summaries collected after each sync. */
export default async function MonitoringPage() {
  const { access } = await getPageAccess("metrics:read");
  if (!access) return <NoAccess what="monitoring data" />;
  const rows = await getDb().metricSummary.findMany({
    where: { organizationId: access.organizationId, metricName: "CPUUtilization", periodDays: 14, resource: { deletedAt: null } },
    include: { resource: { select: { id: true, name: true, resourceId: true, region: true, attributes: true } } },
  });
  const byResource = new Map<string, { id: string; label: string; region: string; type: string; avg: number | null; max: number | null; days: number; at: Date }>();
  for (const r of rows) {
    const e = byResource.get(r.resourceRefId) ?? { id: r.resource.id, label: r.resource.name ?? r.resource.resourceId, region: r.resource.region, type: String((r.resource.attributes as { instanceType?: string }).instanceType ?? ""), avg: null, max: null, days: r.datapoints, at: r.collectedAt };
    if (r.statistic === "Average") e.avg = r.value;
    if (r.statistic === "Maximum") e.max = r.value;
    byResource.set(r.resourceRefId, e);
  }
  const list = [...byResource.values()];
  const withData = list.filter((x) => x.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  const noData = list.filter((x) => x.avg === null);
  const lastAt = list.reduce<Date | null>((m, x) => (!m || x.at > m ? x.at : m), null);
  return (
    <div className="space-y-4">
      <PageHeader title="Monitoring" actions={<SectionActions access={access} label="Refresh metrics" />} description={`EC2 CPU utilisation (14-day daily average and peak) from CloudWatch${lastAt ? ` · collected ${formatRelative(lastAt)}` : ""}. Open an instance for live graphs.`} />
      {list.length === 0 ? (
        <EmptyState title="No utilisation data yet" description="Collected after each inventory sync for running EC2 instances. Requires cloudwatch:GetMetricData." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Average CPU (14 days)</CardTitle>
              <CardDescription className="text-xs">Highest first</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList ariaLabel="Average CPU by instance" items={withData.map((x) => ({ label: `${x.label} · ${x.type}`, value: x.avg ?? 0, display: `${(x.avg ?? 0).toFixed(1)}%`, href: `/cloud/ec2/${x.id}` }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Peak daily CPU (14 days)</CardTitle>
              <CardDescription className="text-xs">Lowest peaks are the strongest idle signals</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList ariaLabel="Peak CPU by instance" items={[...withData].sort((a, b) => (a.max ?? 0) - (b.max ?? 0)).map((x) => ({ label: x.label, value: x.max ?? 0, display: `${(x.max ?? 0).toFixed(1)}%`, href: `/cloud/ec2/${x.id}` }))} />
            </CardContent>
          </Card>
          {noData.length > 0 && (
            <p className="text-sm text-muted-foreground lg:col-span-2">
              No CloudWatch datapoints for: {noData.map((x) => <Link key={x.id} className="underline" href={`/cloud/ec2/${x.id}`}>{x.label} </Link>)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
