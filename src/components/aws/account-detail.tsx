"use client";

import { RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { AccountDto } from "@/lib/types";
import { ConnectionStatusBadge } from "./connection-status";
import { DiagnosticsTable } from "./diagnostics-table";
import { SyncStatusText } from "./sync-status";

export function AccountDetail({
  orgId,
  account,
  canConnect,
  canDisconnect,
  canSync,
}: {
  orgId: string;
  account: AccountDto;
  canConnect: boolean;
  canDisconnect: boolean;
  canSync: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const c = account.connection;
  const base = `/api/v1/orgs/${orgId}/aws-accounts/${account.id}`;

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {account.displayName} {c && <ConnectionStatusBadge status={c.status} />}
            </CardTitle>
            <CardDescription className="font-mono">{account.awsAccountId}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSync && c && c.status !== "PENDING" && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("sync", () => api(`/api/v1/orgs/${orgId}/sync`, { body: { accountId: account.id } }), "Sync queued")}>
                <RefreshCw aria-hidden /> Sync now
              </Button>
            )}
            {canConnect && c?.method === "ASSUME_ROLE" && c.status !== "PENDING" && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("validate", () => api(`${base}/validate`, { body: {} }), "Connection re-validated")}>
                <ShieldCheck aria-hidden /> Re-validate
              </Button>
            )}
            {canConnect && c?.status === "PENDING" && (
              <Button size="sm" asChild>
                <Link href={`/settings/cloud-accounts/connect?resume=${account.id}`}>Continue setup</Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Method</dt>
            <dd>{c?.method === "ACCESS_KEY" ? `Access key ${c.accessKeyHint ?? ""} (not recommended)` : "IAM role + sts:AssumeRole with ExternalId"}</dd>
            <dt className="text-muted-foreground">Role ARN</dt>
            <dd className="break-all font-mono text-xs">{c?.roleArn ?? "—"}</dd>
            <dt className="text-muted-foreground">Status detail</dt>
            <dd>{c?.statusMessage ?? "—"}</dd>
            <dt className="text-muted-foreground">Last validated</dt>
            <dd>{c?.lastValidatedAt ? formatDateTime(c.lastValidatedAt) : "—"}</dd>
            <dt className="text-muted-foreground">Last sync</dt>
            <dd>
              <SyncStatusText status={account.syncStatus} lastSyncedAt={account.lastSyncedAt} error={account.syncError} />
              {account.syncError && <p className="text-xs text-muted-foreground">{account.syncError}</p>}
            </dd>
            <dt className="text-muted-foreground">Enabled regions</dt>
            <dd className="flex flex-wrap gap-1">
              {c?.enabledRegions.length ? c.enabledRegions.map((r) => <code key={r} className="rounded bg-muted px-1.5 py-0.5 text-xs">{r}</code>) : "—"}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {c?.method === "ACCESS_KEY" && (
        <Alert variant="destructive">
          <AlertTitle>Long-term access keys in use</AlertTitle>
          <AlertDescription>
            Access keys are encrypted at rest but are long-lived secrets. Migrate to IAM role onboarding and delete the key in AWS.
          </AlertDescription>
        </Alert>
      )}

      {c?.diagnostics && (
        <Card>
          <CardHeader>
            <CardTitle>Permission diagnostics</CardTitle>
            <CardDescription>Checked {formatDateTime(c.diagnostics.checkedAt)}. Denied optional checks only disable the related features.</CardDescription>
          </CardHeader>
          <CardContent>
            <DiagnosticsTable probes={c.diagnostics.probes} />
          </CardContent>
        </Card>
      )}

      {canDisconnect && (
        <Card className="border-status-critical/30">
          <CardHeader>
            <CardTitle>Disconnect account</CardTitle>
            <CardDescription>
              Deletes this connection and all synced inventory, cost and findings for the account from Stratus. It does not change
              anything in AWS — delete the <code>StratusReadOnlyRole</code> stack yourself to fully revoke access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog onOpenChange={() => setConfirmText("")}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Unplug aria-hidden /> Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect {account.displayName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    AWS account {account.awsAccountId}. Synced data for this account will be permanently removed from Stratus. Type the
                    account ID to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1">
                  <Label htmlFor="confirm-account">AWS account ID</Label>
                  <Input id="confirm-account" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono" autoComplete="off" />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmText !== account.awsAccountId || busy !== null}
                    onClick={() =>
                      void act("disconnect", () => api(base, { method: "DELETE" }), "Account disconnected").then(() => router.push("/settings/cloud-accounts"))
                    }
                  >
                    Disconnect account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
