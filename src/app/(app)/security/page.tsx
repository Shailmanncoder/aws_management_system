import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { FindingAction } from "@/components/security/finding-action";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";
import { FINDING_SOURCES, FINDING_STATUSES, SEVERITIES, listSecurityFindings } from "@/server/services/findings-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Security Center" };
const options = (values: readonly string[]) => values.map((value) => ({ value, label: value.replaceAll("_", " ") }));

export default async function SecurityPage({ searchParams }: PageProps<"/security">) {
  const { access } = await getPageAccess("security:read");
  if (!access) return <NoAccess what="security findings" />;
  const raw = await searchParams;
  const data = await listSecurityFindings(access, raw);
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return <div className="space-y-5">
    <PageHeader title="Security Center" description="Configuration risks and AWS security findings. Findings include evidence and investigation guidance; scans never modify AWS resources."
      actions={<SectionActions access={access} account={raw.account} label="Rescan">{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="security" query={query} /> : null}</SectionActions>} />
    <section aria-label="Scan coverage" className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <h2 className="font-semibold">Scan coverage</h2>
      {data.accounts.length === 0 && <p className="text-muted-foreground">Connect an AWS account to start collecting security signals.</p>}
      {data.accounts.map((account) => {
        const coverage = account.securityCoverage as { gaps?: string[]; examined?: number } | null;
        return <div key={account.id}>
          <p><span className="font-medium">{account.displayName}</span> · {account.securityScannedAt ? `Last scan ${formatRelative(account.securityScannedAt)}` : "Not yet scanned — run an inventory sync"}</p>
          {coverage && <p className="text-muted-foreground">{coverage.examined ?? 0} resources evaluated. {coverage.gaps?.length ? `Incomplete checks: ${coverage.gaps.join("; ")}. Previous findings are retained where checks are unavailable.` : "Configured checks completed. This is not a guarantee that the account is secure."}</p>}
        </div>;
      })}
    </section>
    <FilterBar tagFilter={false} searchPlaceholder="Search findings or rule ID…" facets={[
      { param: "severity", label: "Severity", options: options(SEVERITIES) },
      { param: "status", label: "Status (default: open)", options: options(FINDING_STATUSES) },
      { param: "source", label: "Source", options: options(FINDING_SOURCES) },
    ]} />
    <p className="text-sm text-muted-foreground">{data.total} matching findings · Open findings shown by default</p>
    {data.items.length === 0 ? <EmptyState title="No matching findings" description="Check scan coverage above. Missing permissions or incomplete checks can leave risks undetected." /> : data.items.map((finding) => <article key={finding.id} className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={finding.severity === "CRITICAL" || finding.severity === "HIGH" ? "destructive" : "secondary"}>{finding.severity}</Badge><Badge variant="outline">{finding.status}</Badge><span className="text-xs text-muted-foreground">{finding.source.replaceAll("_", " ")} · {finding.awsAccount.displayName} · {finding.region}</span></div>
      <h2 className="font-semibold">{finding.title}</h2>
      <p className="text-sm">{finding.description}</p>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Evidence and remediation</summary><div className="mt-3 space-y-3">
        <p><strong>Why it matters:</strong> {finding.rationale}</p>
        <pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(finding.evidence, null, 2)}</pre>
        <p><strong>Investigate or remediate:</strong> {finding.remediation}</p>
        <p className="text-xs text-muted-foreground">Rule {finding.ruleId} · First seen {formatRelative(finding.firstSeenAt)} · Last detected {formatRelative(finding.lastSeenAt)}</p>
        {access.can("security:manage") && finding.status !== "RESOLVED" && <FindingAction orgId={access.organizationId} findingId={finding.id} suppressed={finding.status === "SUPPRESSED"} />}
      </div></details>
    </article>)}
    <Pagination pathname="/security" params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
  </div>;
}
