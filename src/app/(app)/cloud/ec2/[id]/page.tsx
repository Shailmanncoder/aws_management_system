import { SectionActions } from "@/app/(app)/_components/section-actions";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricsPanel } from "@/components/charts/metrics-panel";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { StateBadge } from "@/components/data/state-badge";
import { FindingsForResource } from "@/components/resource/findings-for-resource";
import { KeyValue, Mono } from "@/components/resource/kv";
import { SecurityGroupRules } from "@/components/resource/sg-rules";
import { TagsTable } from "@/components/resource/tags-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatRelative } from "@/lib/format";
import { RESOURCE_TYPES, type EbsVolumeAttrs, type Ec2InstanceAttrs, type SecurityGroupAttrs } from "@/lib/resource-types";
import { isAppError } from "@/server/errors";
import { findingsForResource } from "@/server/services/findings-service";
import { getRelated, getResourceDetail } from "@/server/services/inventory-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "EC2 instance" };

export default async function Ec2DetailPage({ params }: PageProps<"/cloud/ec2/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="EC2 inventory" />;
  const r = await getResourceDetail(access, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (r.resourceType !== RESOURCE_TYPES.EC2_INSTANCE) notFound();
  const a = r.attributes as unknown as Ec2InstanceAttrs;
  const findings = await findingsForResource(access, r.id);
  const [volumes, groups] = await Promise.all([
    getRelated(access, r.account.id, RESOURCE_TYPES.EBS_VOLUME, a.volumeIds),
    getRelated(access, r.account.id, RESOURCE_TYPES.SECURITY_GROUP, a.securityGroups.map((g) => g.id)),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader actions={<SectionActions access={access} account={r.account.id} label="Refresh" />}
        eyebrow={
          <Link href="/cloud/ec2" className="hover:underline">
            EC2 instances
          </Link>
        }
        title={r.name ?? r.resourceId}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{r.resourceId}</Mono> <StateBadge state={r.state} /> <span>{a.instanceType}</span>
            <span>
              {r.account.displayName} · {r.region}
            </span>
          </span>
        }
      />
      {r.deletedAt && <p className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm">This instance was not found in the latest sync ({formatDateTime(r.deletedAt)}).</p>}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="networking">Networking</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <Card>
            <CardContent className="pt-6">
              <KeyValue
                items={[
                  ["Instance ID", <Mono key="i">{r.resourceId}</Mono>],
                  ["State", <StateBadge key="s" state={r.state} />],
                  ["State reason", a.stateReason],
                  ["Instance type", a.instanceType],
                  ["Architecture", a.architecture],
                  ["Platform", a.platform],
                  ["Region / AZ", `${r.region} / ${a.availabilityZone ?? "—"}`],
                  ["Launch time", a.launchTime ? `${formatDateTime(a.launchTime)} (${formatRelative(a.launchTime)})` : null],
                  ["Stopped since", a.stoppedAt ? `${formatDateTime(a.stoppedAt)} (${formatRelative(a.stoppedAt)})` : null],
                  ["IAM instance profile", a.iamInstanceProfileArn ? <Mono key="p">{a.iamInstanceProfileArn}</Mono> : null],
                  ["Detailed monitoring", a.monitoring],
                  ["ARN", r.arn ? <Mono key="a">{r.arn}</Mono> : null],
                  ["AWS account", `${r.account.displayName} (${r.account.awsAccountId})`],
                  ["Last seen", `${formatDateTime(r.lastSeenAt)}`],
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="networking" className="space-y-4 pt-3">
          <Card>
            <CardContent className="pt-6">
              <KeyValue
                items={[
                  ["Public IP", a.publicIp ? <Mono key="p">{a.publicIp}</Mono> : null],
                  ["Private IP", a.privateIp ? <Mono key="q">{a.privateIp}</Mono> : null],
                  ["VPC", a.vpcId ? <Link key="v" className="font-mono text-xs hover:underline" href={`/cloud/network?vpc=${encodeURIComponent(a.vpcId)}`}>{a.vpcId}</Link> : null],
                  ["Subnet", a.subnetId ? <Mono key="s">{a.subnetId}</Mono> : null],
                  ["Security groups", a.securityGroups.map((g) => `${g.name ?? ""} (${g.id})`).join(", ")],
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="storage" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>Attached EBS volumes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {volumes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attached volumes were found in the inventory.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Volume</TableHead>
                      <TableHead scope="col">Size</TableHead>
                      <TableHead scope="col">Type</TableHead>
                      <TableHead scope="col">Encrypted</TableHead>
                      <TableHead scope="col">State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volumes.map((v) => {
                      const va = v.attributes as unknown as EbsVolumeAttrs;
                      return (
                        <TableRow key={v.id}>
                          <TableCell className="font-mono text-xs">{v.resourceId}</TableCell>
                          <TableCell className="tabular">{va.sizeGiB} GiB</TableCell>
                          <TableCell>{va.volumeType}</TableCell>
                          <TableCell>{va.encrypted ? "Yes" : <span className="font-medium text-status-critical">No</span>}</TableCell>
                          <TableCell>
                            <StateBadge state={v.state} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="monitoring" className="pt-3">
          <MetricsPanel orgId={access.organizationId} resourceId={r.id} kind="ec2" />
        </TabsContent>
        <TabsContent value="security" className="space-y-4 pt-3">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {g.name} <Mono>{g.resourceId}</Mono>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SecurityGroupRules rules={(g.attributes as unknown as SecurityGroupAttrs).ingress} />
              </CardContent>
            </Card>
          ))}
          <FindingsForResource findings={findings} />
        </TabsContent>
        <TabsContent value="tags" className="pt-3">
          <TagsTable tags={r.tags} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
