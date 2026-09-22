import type { Metadata } from "next";
import Link from "next/link";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { TableShell } from "@/components/resource/table-shell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { buildHref } from "@/lib/url";
import { AUDIT } from "@/server/services/audit-service";
import { getAuditLog } from "@/server/services/audit-query-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const { access } = await getPageAccess("audit:read");
  if (!access) return <NoAccess what="audit logs" />;
  const raw = await searchParams;
  const data = await getAuditLog(access, raw);
  const query = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "cursor"));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit logs"
        description="Append-only record of sensitive actions. Entries cannot be edited or deleted (enforced by database triggers)."
        actions={access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="audit" query={query} /> : undefined}
      />
      <FilterBar
        tagFilter={false}
        searchPlaceholder="(filter by action below)"
        facets={[
          { param: "action", label: "Action", options: Object.values(AUDIT).sort().map((a) => ({ value: a, label: a })) },
          { param: "outcome", label: "Outcome", options: [{ value: "SUCCESS", label: "Success" }, { value: "FAILURE", label: "Failure" }] },
        ]}
      />
      {data.items.length === 0 ? (
        <EmptyState title="No audit events" description="Events appear as members sign in, connect accounts, run syncs and export reports." />
      ) : (
        <TableShell caption="Audit events">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Time</TableHead>
                <TableHead scope="col">Actor</TableHead>
                <TableHead scope="col">Action</TableHead>
                <TableHead scope="col">Target</TableHead>
                <TableHead scope="col">Outcome</TableHead>
                <TableHead scope="col">Request ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell className="text-sm">{e.actor?.email ?? (e.actorType === "SYSTEM" ? "System" : "Deleted user")}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs" title={e.targetId ?? undefined}>{e.targetType ? `${e.targetType}:${e.targetId ?? ""}` : "—"}</TableCell>
                  <TableCell className={e.outcome === "FAILURE" ? "font-medium text-status-critical" : "text-sm"}>{e.outcome.toLowerCase()}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{e.requestId?.slice(0, 13) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
      <div className="flex justify-between">
        {raw.cursor ? <Button asChild variant="outline" size="sm"><Link href={buildHref("/audit", raw, { cursor: null })}>Newest</Link></Button> : <span />}
        {data.nextCursor && <Button asChild variant="outline" size="sm"><Link href={buildHref("/audit", raw, { cursor: data.nextCursor })}>Older →</Link></Button>}
      </div>
    </div>
  );
}
