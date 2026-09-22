import { SectionActions } from "@/app/(app)/_components/section-actions";
import { CheckCircle2, CircleHelp, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { ExposureBadge } from "@/components/resource/exposure-badge";
import { FindingsForResource } from "@/components/resource/findings-for-resource";
import { KeyValue, Mono } from "@/components/resource/kv";
import { ObservedValue } from "@/components/resource/observed";
import { TagsTable } from "@/components/resource/tags-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { RESOURCE_TYPES, type S3BucketAttrs } from "@/lib/resource-types";
import { assessBucketExposure } from "@/lib/s3-posture";
import { isAppError } from "@/server/errors";
import { findingsForResource } from "@/server/services/findings-service";
import { getResourceDetail } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "S3 bucket" };

export default async function S3DetailPage({ params }: PageProps<"/cloud/s3/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="S3 inventory" />;
  const r = await getResourceDetail(access, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (r.resourceType !== RESOURCE_TYPES.S3_BUCKET) notFound();
  const a = r.attributes as unknown as S3BucketAttrs;
  const findings = await findingsForResource(access, r.id);
  const exposure = assessBucketExposure(a);
  const icon = { risk: ShieldAlert, ok: CheckCircle2, unknown: CircleHelp } as const;

  return (
    <div className="space-y-4">
      <PageHeader actions={<SectionActions access={access} account={r.account.id} label="Refresh" />}
        eyebrow={<Link href="/cloud/s3" className="hover:underline">S3 buckets</Link>}
        title={r.resourceId}
        description={`${r.account.displayName} (${r.account.awsAccountId}) · ${r.region}`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Public access assessment <ExposureBadge level={exposure.level} />
            </CardTitle>
            <CardDescription>Why Stratus reached this conclusion:</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {exposure.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="font-medium">Evidence</p>
            <ul className="space-y-1.5">
              {exposure.signals.map((s) => {
                const Icon = icon[s.kind];
                return (
                  <li key={s.label} className="flex items-start gap-2">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${s.kind === "risk" ? "text-status-critical" : s.kind === "ok" ? "text-success-text" : "text-muted-foreground"}`} aria-hidden />
                    <span>
                      <span className="text-muted-foreground">{s.label}:</span> {s.value}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValue
              items={[
                ["ARN", <Mono key="a">{r.arn}</Mono>],
                ["Created", a.creationDate ? formatDateTime(a.creationDate) : null],
                ["Default encryption", <ObservedValue key="e" value={a.encryption} render={(e) => (e ? `${e.algorithm}${e.kmsKeyId ? ` (${e.kmsKeyId})` : ""}${e.bucketKeyEnabled ? ", bucket key" : ""}` : "None")} />],
                ["Versioning", <ObservedValue key="v" value={a.versioning} render={(v) => v} />],
                ["Server access logging", <ObservedValue key="l" value={a.logging} render={(l) => (l.enabled ? `Enabled → ${l.targetBucket}` : "Disabled")} />],
                ["Lifecycle rules", <ObservedValue key="lc" value={a.lifecycleRuleCount} render={(n) => String(n)} />],
                ["Last seen", formatDateTime(r.lastSeenAt)],
              ]}
            />
          </CardContent>
        </Card>
      </div>
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
