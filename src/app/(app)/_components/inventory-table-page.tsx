import { SectionActions } from "./section-actions";
import Link from "next/link";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar, type FacetDef } from "@/components/data/filter-bar";
import { SharedInventoryViews } from "@/app/(app)/_components/shared-inventory-views";
import { InventoryViews } from "@/components/data/inventory-views";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { StateBadge } from "@/components/data/state-badge";
import { TagList } from "@/components/data/tag-list";
import { TableShell } from "@/components/resource/table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RESOURCE_TYPE_LABELS, type ResourceType } from "@/lib/resource-types";
import { buildHref } from "@/lib/url";
import { cn } from "@/lib/utils";
import { getFacets, listInventory, parseListParams, type ResourceDto } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";

export interface Column {
  header: string;
  cell: (r: ResourceDto) => React.ReactNode;
  className?: string;
}

export interface TypeTab {
  type: ResourceType;
  label: string;
  columns: Column[];
}

/**
 * Generic server-rendered inventory page: type tabs, URL filters, sortable columns, server
 * pagination and CSV export — all tenant-scoped through the inventory service.
 */
export async function InventoryTablePage({
  title,
  description,
  path,
  tabs,
  searchParams,
  rowHref,
  extraFacets = [],
}: {
  title: string;
  description: string;
  path: string;
  tabs: TypeTab[];
  searchParams: Record<string, string | string[] | undefined>;
  rowHref?: (r: ResourceDto) => string | null;
  extraFacets?: FacetDef[];
}) {
  const { ctx, access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what={title} />;
  const params = parseListParams(searchParams);
  const tab = tabs.find((t) => t.type === params.type) ?? tabs[0]!;
  const [data, facets] = await Promise.all([listInventory(access, [tab.type], { ...params, type: tab.type }), getFacets(access, [tab.type])]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={<SectionActions access={access} account={searchParams.account}>{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="inventory" query={{ type: tab.type, q: params.q, region: params.region, account: params.account, state: params.state, tag: params.tag, vpc: params.vpc, instanceType: params.instanceType, sort: params.sort, dir: params.dir, unowned: params.unowned }} /> : null}</SectionActions>}
      />
      {tabs.length > 1 && (
        <nav aria-label={`${title} types`} className="-mx-1 flex gap-1 overflow-x-auto border-b">
          {tabs.map((t) => (
            <Link
              key={t.type}
              href={buildHref(path, {}, { type: t.type === tabs[0]!.type ? null : t.type, account: params.account, region: params.region })}
              aria-current={t.type === tab.type ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground", t.type === tab.type ? "border-primary font-medium text-foreground" : "border-transparent")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      <SharedInventoryViews access={access} path={path} />
      <InventoryViews userId={ctx.user.id} orgId={access.organizationId} />
      <FilterBar facets={[{ param: "state", label: "State", options: facets.states.map((s) => ({ value: s, label: s })) }, { param: "unowned", label: "Ownership", options: [{ value: "true", label: "No assigned owner" }] }, ...extraFacets]} />
      {data.total === 0 ? (
        <EmptyState title={`No ${RESOURCE_TYPE_LABELS[tab.type]} resources found`} description="Adjust filters, check permission diagnostics for this service, or run a sync." />
      ) : (
        <>
          <TableShell caption={tab.label}>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Name" field="name" pathname={path} params={searchParams} className="sticky left-0 bg-card" />
                  <SortHeader label="State" field="state" pathname={path} params={searchParams} />
                  <SortHeader label="Region" field="region" pathname={path} params={searchParams} />
                  {tab.columns.map((c) => (
                    <TableHead scope="col" key={c.header}>
                      {c.header}
                    </TableHead>
                  ))}
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const href = rowHref?.(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="sticky left-0 bg-card font-medium">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {r.name ?? r.resourceId}
                          </Link>
                        ) : (
                          (r.name ?? r.resourceId)
                        )}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={r.state} />
                      </TableCell>
                      <TableCell className="text-xs">{r.region}</TableCell>
                      {tab.columns.map((c) => (
                        <TableCell key={c.header} className={cn("text-sm", c.className)}>
                          {c.cell(r)}
                        </TableCell>
                      ))}
                      <TableCell className="text-xs">{r.account.displayName}</TableCell>
                      <TableCell>
                        <TagList tags={r.tags} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableShell>
          <Pagination pathname={path} params={searchParams} page={data.page} pageSize={data.pageSize} total={data.total} />
        </>
      )}
    </div>
  );
}

/** Small typed cell helpers. */
export const Risk = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-status-critical">{children}</span>;
export const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children ?? "—"}</span>;
export const yesNo = (v: boolean, riskyWhen?: boolean) => (riskyWhen !== undefined && v === riskyWhen ? <Risk>{v ? "Yes" : "No"}</Risk> : v ? "Yes" : "No");
