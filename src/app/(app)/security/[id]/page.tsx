import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { SeverityBadge, type SeverityValue } from "@/components/findings/severity";
import { KeyValue, Mono } from "@/components/resource/kv";
import { FindingAction } from "@/components/security/finding-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { walkthroughForRule } from "@/lib/walkthroughs";
import { buildHref } from "@/lib/url";
import { resourceHref } from "@/lib/resource-links";
import { getSecurityFinding } from "@/server/services/findings-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "Security finding" };

export default async function FindingPage({ params }: PageProps<"/security/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { access } = await getPageAccess("security:read");
  if (!access) return <NoAccess what="security findings" />;
  const f = await getSecurityFinding(access, id);
  if (!f) notFound();
  // A step-by-step fix exists for most rules; link to it with this finding's own resource filled in.
  const guide = walkthroughForRule(f.ruleId);
  const guideHref = guide
    ? buildHref(`/guides/${guide.id}`, {}, { region: f.region, resource: f.resource?.resourceId ?? null })
    : null;
  return (
    <div className="space-y-4">
      <PageHeader actions={<SectionActions access={access} account={f.awsAccountRefId} label="Refresh" />} eyebrow={<Link href="/security" className="hover:underline">Security Center</Link>} title={f.title} description={<span className="flex flex-wrap items-center gap-2"><SeverityBadge severity={f.severity as SeverityValue} /> {f.status} · {f.source.replaceAll("_", " ")}</span>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>What was detected</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{f.description}</p>
            <p><strong>Why it matters.</strong> {f.rationale}</p>
            <p><strong>How to investigate / remediate.</strong> {f.remediation}</p>
            {guide && guideHref && (
              <p>
                <Link href={guideHref} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <BookOpen className="size-4" aria-hidden />
                  Show me exactly where to click: {guide.title}
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(f.evidence, null, 2)}</pre>
            <KeyValue items={[
              ["AWS account", `${f.awsAccount.displayName} (${f.awsAccount.awsAccountId})`],
              ["Region", f.region],
              ["Resource", f.resource ? <Link key="r" className="hover:underline" href={resourceHref(f.resource.resourceType, f.resource.id, f.resource.resourceId)}>{f.resource.name ?? f.resource.resourceId}</Link> : "Account-level"],
              ["Rule", <Mono key="rule">{f.ruleId}</Mono>],
              ["First seen", formatDateTime(f.firstSeenAt)],
              ["Last detected", formatDateTime(f.lastSeenAt)],
              ["Resolved", f.resolvedAt ? formatDateTime(f.resolvedAt) : null],
            ]} />
          </CardContent>
        </Card>
      </div>
      {access.can("security:manage") && f.status !== "RESOLVED" && <FindingAction orgId={access.organizationId} findingId={f.id} suppressed={f.status === "SUPPRESSED"} />}
    </div>
  );
}
