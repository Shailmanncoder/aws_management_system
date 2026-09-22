import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Topbar } from "@/components/layout/topbar";
import { Suspense } from "react";
import { LiveUpdates } from "@/components/layout/live-updates";
import { ScopeFilter } from "@/components/layout/scope-filter";
import { getEnv } from "@/server/env";
import { listAccounts } from "@/server/repositories/aws-account-repository";
import { getWorkspaceContext } from "@/server/services/workspace-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWorkspaceContext();
  const fixtures = getEnv().AWS_MODE === "fixtures";
  // Every role holds aws_accounts:read; ids/labels only (no connection secrets).
  const accounts = await listAccounts(ctx.org.id);
  const regions = [...new Set(accounts.flatMap((a) => a.connection?.enabledRegions ?? []))].sort();
  return (
    <LiveUpdates orgId={ctx.org.id}>
    <AppShell
      role={ctx.role}
      topbar={
        <Topbar ctx={ctx}>
          <Suspense>
            <ScopeFilter accounts={accounts.map((a) => ({ id: a.id, label: `${a.displayName} (${a.awsAccountId})` }))} regions={regions} />
          </Suspense>
        </Topbar>
      }
      banner={
        fixtures ? (
          <div role="status" className="flex items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-1.5 text-xs">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Fixture mode.</strong> AWS data shown is synthetic test data, not from a real AWS account.
            </span>
          </div>
        ) : undefined
      }
    >
      {children}
    </AppShell>
    </LiveUpdates>
  );
}
