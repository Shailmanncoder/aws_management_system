import { CreateResource } from "@/components/aws/create-resource";
import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { ExportButton } from "@/components/common/export-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { StateBadge } from "@/components/data/state-badge";
import { TagList } from "@/components/data/tag-list";
import { TableShell } from "@/components/resource/table-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { RESOURCE_TYPES, type Ec2InstanceAttrs } from "@/lib/resource-types";
import { getAttributeFacet, getFacets, listInventory, parseListParams } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "EC2 instances" };
const TYPES = [RESOURCE_TYPES.EC2_INSTANCE];

export default async function Ec2Page({ searchParams }: PageProps<"/cloud/ec2">) {
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="EC2 inventory" />;
  const raw = await searchParams;
  const params = parseListParams(raw);
  const [data, facets, instanceTypes, vpcs] = await Promise.all([
    listInventory(access, TYPES, params),
    getFacets(access, TYPES),
    getAttributeFacet(access, RESOURCE_TYPES.EC2_INSTANCE, "instanceType"),
    getAttributeFacet(access, RESOURCE_TYPES.EC2_INSTANCE, "vpcId"),
  ]);
  const path = "/cloud/ec2";

  return (
    <div className="space-y-4">
      <PageHeader
        title="EC2 instances"
        description="Instances across all connected accounts and enabled regions, from the latest inventory sync."
        actions={<SectionActions access={access} account={raw.account}>{access.can("provisioning:create") ? <CreateResource orgId={access.organizationId} service="ec2" /> : null}{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="inventory" query={{ type: "ec2:instance", ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) }} /> : null}</SectionActions>}
      />
      <FilterBar
        facets={[
          { param: "state", label: "State", options: facets.states.map((s) => ({ value: s, label: s })) },
          { param: "instanceType", label: "Instance type", options: instanceTypes.map((s) => ({ value: s, label: s })) },
          { param: "vpc", label: "VPC", options: vpcs.map((s) => ({ value: s, label: s })) },
        ]}
      />
      {data.total === 0 ? (
        <EmptyState title="No instances match" description="Adjust filters, or connect an AWS account and run a sync." />
      ) : (
        <>
          <TableShell caption="EC2 instances">
            <Table>
              <TableCaption className="sr-only">EC2 instances, {data.total} results</TableCaption>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Name" field="name" pathname={path} params={raw} className="sticky left-0 bg-card" />
                  <SortHeader label="Instance ID" field="resourceId" pathname={path} params={raw} />
                  <SortHeader label="State" field="state" pathname={path} params={raw} />
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col">Arch</TableHead>
                  <SortHeader label="Region / AZ" field="region" pathname={path} params={raw} />
                  <TableHead scope="col">Public IP</TableHead>
                  <TableHead scope="col">Private IP</TableHead>
                  <TableHead scope="col">VPC / Subnet</TableHead>
                  <TableHead scope="col">Security groups</TableHead>
                  <TableHead scope="col">Instance profile</TableHead>
                  <TableHead scope="col">Launched</TableHead>
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const a = r.attributes as unknown as Ec2InstanceAttrs;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="sticky left-0 bg-card font-medium">
                        <Link href={`/cloud/ec2/${r.id}`} className="hover:underline">
                          {r.name ?? <span className="text-muted-foreground">(no name)</span>}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.resourceId}</TableCell>
                      <TableCell>
                        <StateBadge state={r.state} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.instanceType}</TableCell>
                      <TableCell className="text-xs">{a.architecture ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.region}
                        <div className="text-muted-foreground">{a.availabilityZone}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.publicIp ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{a.privateIp ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {a.vpcId ?? "—"}
                        <div className="text-muted-foreground">{a.subnetId}</div>
                      </TableCell>
                      <TableCell className="text-xs">{a.securityGroups.map((g) => g.name ?? g.id).join(", ") || "—"}</TableCell>
                      <TableCell className="max-w-40 truncate text-xs" title={a.iamInstanceProfileArn ?? undefined}>
                        {a.iamInstanceProfileArn?.split("/").pop() ?? "—"}
                      </TableCell>
                      <TableCell className="tabular text-xs">{a.launchTime ? formatDate(a.launchTime) : "—"}</TableCell>
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
          <Pagination pathname={path} params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
        </>
      )}
    </div>
  );
}
