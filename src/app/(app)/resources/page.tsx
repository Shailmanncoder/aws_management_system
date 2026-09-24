import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { SharedInventoryViews } from "@/app/(app)/_components/shared-inventory-views";
import { InventoryViews } from "@/components/data/inventory-views";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { StateBadge } from "@/components/data/state-badge";
import { TagList } from "@/components/data/tag-list";
import { TableShell } from "@/components/resource/table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { resourceHref } from "@/lib/resource-links";
import { ALL_RESOURCE_TYPES, RESOURCE_TYPE_LABELS, type ResourceType } from "@/lib/resource-types";
import { getTypeCounts, listInventory, parseListParams } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Resources" };

export default async function ResourcesPage({ searchParams }: PageProps<"/resources">) {
  const { ctx, access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="the resource inventory" />;
  const raw = await searchParams;
  const params = parseListParams(raw);
  const [data, counts] = await Promise.all([listInventory(access, [...ALL_RESOURCE_TYPES], params), getTypeCounts(access)]);
  const path = "/resources";
  const typeOptions = (Object.keys(counts) as ResourceType[]).sort().map((t) => ({ value: t, label: `${RESOURCE_TYPE_LABELS[t] ?? t} (${counts[t]})` }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resources"
        description="Every resource in the normalised inventory across accounts and regions."
        actions={<SectionActions access={access} account={raw.account}>{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="inventory" query={{ q: params.q, type: params.type, region: params.region, account: params.account, state: params.state, tag: params.tag, vpc: params.vpc, instanceType: params.instanceType, sort: params.sort, dir: params.dir, unowned: params.unowned }} /> : null}</SectionActions>}
      />
      <SharedInventoryViews access={access} path={path} />
      <InventoryViews userId={ctx.user.id} orgId={access.organizationId} />
      <FilterBar facets={[{ param: "type", label: "Type", options: typeOptions }, { param: "unowned", label: "Ownership", options: [{ value: "true", label: "No assigned owner" }] }]} />
      {data.total === 0 ? (
        <EmptyState title="No resources found" description="Connect an AWS account and run a sync, or adjust filters." />
      ) : (
        <>
          <TableShell caption="Resources">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Name" field="name" pathname={path} params={raw} />
                  <TableHead scope="col">Type</TableHead>
                  <SortHeader label="Resource ID" field="resourceId" pathname={path} params={raw} />
                  <SortHeader label="State" field="state" pathname={path} params={raw} />
                  <SortHeader label="Region" field="region" pathname={path} params={raw} />
                  <TableHead scope="col">Account</TableHead>
                  <SortHeader label="Last seen" field="lastSeenAt" pathname={path} params={raw} />
                  <TableHead scope="col">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link href={resourceHref(r.resourceType, r.id, r.resourceId)} className="hover:underline">
                        {r.name ?? r.resourceId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{RESOURCE_TYPE_LABELS[r.resourceType] ?? r.resourceType}</TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-xs" title={r.resourceId}>
                      {r.resourceId}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={r.state} />
                    </TableCell>
                    <TableCell className="text-xs">{r.region}</TableCell>
                    <TableCell className="text-xs">{r.account.displayName}</TableCell>
                    <TableCell className="text-xs">{formatRelative(r.lastSeenAt)}</TableCell>
                    <TableCell>
                      <TagList tags={r.tags} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
          <Pagination pathname={path} params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
        </>
      )}
    </div>
  );
}
