import { Explain } from "@/components/simple/explain";
import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { BasisBadge, ConfidenceBadge } from "@/components/findings/basis-badges";
import { KeyValue, Mono } from "@/components/resource/kv";
import { FindingAction } from "@/components/security/finding-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { resourceHref } from "@/lib/resource-links";
import { getOptimizationFinding } from "@/server/services/optimization-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "Recommendation" };

export default async function RecommendationPage({ params }: PageProps<"/optimization/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { access } = await getPageAccess("optimization:read");
  if (!access) return <NoAccess what="optimisation recommendations" />;
  const f = await getOptimizationFinding(access, id);
  if (!f) notFound();
  return (
    <div className="space-y-4">
      <PageHeader actions={<SectionActions access={access} account={f.awsAccountRefId} label="Refresh" />} eyebrow={<Link href="/optimization" className="hover:underline">Optimization</Link>} title={f.title} description={<span className="flex flex-wrap items-center gap-2"><BasisBadge basis={f.dataBasis} /><ConfidenceBadge confidence={f.confidence} /> {f.status}</span>} />
      <div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary underline" href={`/help?kind=optimization&target=${f.id}`}>Ask a teammate about this issue</Link></div>
      <Explain><p>{f.reason}</p><p>This finding comes from saved observations. Review the evidence and last-check time before acting. A suggested change can affect applications that depend on the resource.</p></Explain>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recommendation</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><strong>Reason.</strong> {f.reason}</p>
            <p><strong>Potential impact.</strong> {f.impact}</p>
            <p><strong>Recommended investigation / action.</strong> {f.recommendation}</p>
            <p className="text-muted-foreground"><strong>Confidence & data limitations.</strong> {f.limitations}</p>
            {f.estimatedMonthlySavings && <p className="text-base font-semibold text-success-text">Estimated ≈ {formatCurrency(Number(f.estimatedMonthlySavings), f.savingsCurrency ?? "USD")} per month (list price estimate)</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(f.evidence, null, 2)}</pre>
            <KeyValue items={[
              ["AWS account", `${f.awsAccount.displayName} (${f.awsAccount.awsAccountId})`],
              ["Region", f.region],
              ["Resource", f.resource ? <Link key="r" className="hover:underline" href={resourceHref(f.resource.resourceType, f.resource.id, f.resource.resourceId)}>{f.resource.name ?? f.resource.resourceId}</Link> : null],
              ["Rule", <Mono key="x">{f.ruleId}</Mono>],
              ["First seen", formatDateTime(f.firstSeenAt)],
              ["Last analysed", formatDateTime(f.lastSeenAt)],
            ]} />
          </CardContent>
        </Card>
      </div>
      {access.can("optimization:manage") && f.status !== "RESOLVED" && <FindingAction kind="optimization" orgId={access.organizationId} findingId={f.id} suppressed={f.status === "SUPPRESSED"} />}
    </div>
  );
}
