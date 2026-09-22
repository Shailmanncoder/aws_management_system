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
import { TagList } from "@/components/data/tag-list";
import { ExposureBadge } from "@/components/resource/exposure-badge";
import { ObservedValue } from "@/components/resource/observed";
import { TableShell } from "@/components/resource/table-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { RESOURCE_TYPES, type S3BucketAttrs } from "@/lib/resource-types";
import { assessBucketExposure } from "@/lib/s3-posture";
import { getFacets, listInventory, parseListParams } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "S3 buckets" };
const TYPES = [RESOURCE_TYPES.S3_BUCKET];

const Risk = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-status-critical">{children}</span>;

export default async function S3Page({ searchParams }: PageProps<"/cloud/s3">) {
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="S3 inventory" />;
  const raw = await searchParams;
  const params = parseListParams(raw);
  const [data] = await Promise.all([listInventory(access, TYPES, params), getFacets(access, TYPES)]);
  const path = "/cloud/s3";

  return (
    <div className="space-y-4">
      <PageHeader
        title="S3 buckets"
        description="Bucket configuration posture. Public exposure is only reported when a public grant AND the absence of an effective Block Public Access setting are both confirmed."
        actions={<SectionActions access={access} account={raw.account}>{access.can("provisioning:create") ? <CreateResource orgId={access.organizationId} service="s3" /> : null}{access.can("reports:export") ? <ExportButton orgId={access.organizationId} report="inventory" query={{ type: "s3:bucket" }} /> : null}</SectionActions>}
      />
      <FilterBar />
      {data.total === 0 ? (
        <EmptyState title="No buckets match" description="Adjust filters or run a sync." />
      ) : (
        <>
          <TableShell caption="S3 buckets">
            <Table>
              <TableCaption className="sr-only">S3 buckets and their configuration posture</TableCaption>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Bucket" field="name" pathname={path} params={raw} className="sticky left-0 bg-card" />
                  <SortHeader label="Region" field="region" pathname={path} params={raw} />
                  <TableHead scope="col">Created</TableHead>
                  <TableHead scope="col">Public access</TableHead>
                  <TableHead scope="col">Encryption</TableHead>
                  <TableHead scope="col">Versioning</TableHead>
                  <TableHead scope="col">Logging</TableHead>
                  <TableHead scope="col">Lifecycle</TableHead>
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const a = r.attributes as unknown as S3BucketAttrs;
                  const exposure = assessBucketExposure(a);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="sticky left-0 bg-card font-medium">
                        <Link href={`/cloud/s3/${r.id}`} className="hover:underline">
                          {r.resourceId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{r.region}</TableCell>
                      <TableCell className="tabular text-xs">{a.creationDate ? formatDate(a.creationDate) : "—"}</TableCell>
                      <TableCell>
                        <ExposureBadge level={exposure.level} title={exposure.reasons.join(" ")} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <ObservedValue value={a.encryption} render={(e) => (e ? (e.algorithm === "aws:kms" || e.algorithm === "aws:kms:dsse" ? "SSE-KMS" : "SSE-S3") : <Risk>None</Risk>)} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <ObservedValue value={a.versioning} render={(v) => (v === "Enabled" ? "Enabled" : v === "Suspended" ? "Suspended" : "Disabled")} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <ObservedValue value={a.logging} render={(l) => (l.enabled ? "Enabled" : "Disabled")} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <ObservedValue value={a.lifecycleRuleCount} render={(n) => (n > 0 ? `${n} rule${n > 1 ? "s" : ""}` : "None")} />
                      </TableCell>
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
