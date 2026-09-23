import { SectionActions } from "@/app/(app)/_components/section-actions";
import { TagEditorDialog } from "@/components/resource/tag-editor-dialog";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricsPanel } from "@/components/charts/metrics-panel";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { FindingsForResource } from "@/components/resource/findings-for-resource";
import { KeyValue, Mono } from "@/components/resource/kv";
import { TagsTable } from "@/components/resource/tags-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatDateTime } from "@/lib/format";
import { RESOURCE_TYPES, type LambdaAttrs } from "@/lib/resource-types";
import { isAppError } from "@/server/errors";
import { findingsForResource } from "@/server/services/findings-service";
import { getResourceDetail } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "Lambda function" };

export default async function LambdaDetailPage({ params }: PageProps<"/cloud/serverless/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="serverless inventory" />;
  const r = await getResourceDetail(access, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (r.resourceType !== RESOURCE_TYPES.LAMBDA_FUNCTION) notFound();
  const a = r.attributes as unknown as LambdaAttrs;
  const findings = await findingsForResource(access, r.id);
  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TagEditorDialog
              orgId={access.organizationId}
              resourceId={r.id}
              resourceName={r.name || r.resourceId}
              initialTags={r.tags}
              disabled={!access.can("actions:request") && !access.can("provisioning:create")}
            />
            <SectionActions access={access} account={r.account.id} label="Refresh" />
          </div>
        }
        eyebrow={<Link href="/cloud/serverless" className="hover:underline">Serverless</Link>}
        title={r.resourceId}
        description={`${r.account.displayName} · ${r.region}`}
      />
      <Card>
        <CardContent className="pt-6">
          <KeyValue
            items={[
              ["ARN", <Mono key="a">{r.arn}</Mono>],
              ["Runtime", a.runtime],
              ["Memory", a.memoryMb ? `${a.memoryMb} MB` : null],
              ["Timeout", a.timeoutSec ? `${a.timeoutSec} s` : null],
              ["Architecture", a.architecture],
              ["Package", a.packageType],
              ["Code size", a.codeSizeBytes ? formatBytes(a.codeSizeBytes) : null],
              ["Layers", String(a.layerCount)],
              ["VPC", a.vpcId ? <Mono key="v">{a.vpcId}</Mono> : "Not attached"],
              ["Environment variables", `${a.environmentVariableCount} defined (values are never read by Stratus)`],
              ["Last modified", a.lastModified ? formatDateTime(a.lastModified) : null],
            ]}
          />
        </CardContent>
      </Card>
      {access.can("metrics:read") && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Monitoring</h2>
          <MetricsPanel orgId={access.organizationId} resourceId={r.id} kind="lambda" />
        </section>
      )}
      <FindingsForResource findings={findings} />
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <TagsTable tags={r.tags} />
        </CardContent>
      </Card>
    </div>
  );
}
