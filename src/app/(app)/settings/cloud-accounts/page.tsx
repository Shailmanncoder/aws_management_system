import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionStatusBadge } from "@/components/aws/connection-status";
import { PlatformCredentialsForm } from "@/components/aws/platform-credentials-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_REGIONS } from "@/lib/regions";
import { getPlatformSetup } from "@/server/services/platform-setup-service";
import { SyncStatusText } from "@/components/aws/sync-status";
import { EmptyState, NoAccess } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAwsAccounts } from "@/server/services/connection-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Cloud accounts" };

export default async function CloudAccountsPage() {
  const { ctx, access } = await getPageAccess("aws_accounts:read");
  if (!access) return <NoAccess what="cloud accounts" />;
  const accounts = await listAwsAccounts(access);
  const canConnect = access.can("aws_accounts:connect");
  // Only the installing Owner of a single-workspace deployment may set platform credentials;
  // for anyone else the service refuses and the card is simply not shown.
  const platform = await getPlatformSetup(access).catch(() => null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[{name:"Amazon Web Services",href:"/settings/cloud-accounts/connect",text:"AWS accounts and IAM roles"},{name:"Google Cloud",href:"/cloud/gcp",text:"Projects, resources, billing and findings"},{name:"Microsoft Azure",href:"/cloud/azure",text:"Subscriptions, resources, costs and assessments"}].map(p=><Link key={p.href} href={p.href} className="rounded-lg border bg-card p-4 hover:bg-accent"><h2 className="font-medium">{p.name}</h2><p className="mt-1 text-xs text-muted-foreground">{p.text}</p></Link>)}
      </div>
      {platform && (
        <Card>
          <CardHeader>
            <CardTitle>Stratus&apos;s own AWS access</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformCredentialsForm orgId={access.organizationId} initial={platform} regions={[...KNOWN_REGIONS]} />
          </CardContent>
        </Card>
      )}
      {accounts.length > 0 && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm">
          <p className="font-medium">Your AWS connections work on every device.</p>
          <p className="mt-1 text-muted-foreground">
            Sign in with the same Stratus account and select the <strong>{ctx.org.name}</strong> workspace. Connections and synced data belong to the workspace,
            so you do not need to enter AWS keys again on each device.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">AWS accounts connected through a read-only cross-account IAM role.</p>
        {canConnect && (
          <Button asChild size="sm">
            <Link href="/settings/cloud-accounts/connect">
              <Plus aria-hidden /> Connect AWS
            </Link>
          </Button>
        )}
      </div>
      {accounts.length === 0 ? (
        <EmptyState
          title="No AWS accounts connected"
          description="Connect an account with a read-only IAM role. Stratus never needs long-term keys or root credentials."
          action={
            canConnect ? (
              <Button asChild>
                <Link href="/settings/cloud-accounts/connect">Connect AWS account</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Account</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Regions</TableHead>
                <TableHead scope="col">Last sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/settings/cloud-accounts/${a.id}`} className="font-medium hover:underline">
                      {a.displayName}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{a.awsAccountId}</div>
                  </TableCell>
                  <TableCell>{a.connection && <ConnectionStatusBadge status={a.connection.status} />}</TableCell>
                  <TableCell className="tabular text-sm">{a.connection?.enabledRegions.length ?? 0}</TableCell>
                  <TableCell>
                    <SyncStatusText status={a.syncStatus} lastSyncedAt={a.lastSyncedAt?.toISOString() ?? null} error={a.syncError} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
