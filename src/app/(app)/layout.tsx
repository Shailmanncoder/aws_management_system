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
  // Warn about synthetic data based on what is STORED, not on how this process is configured.
  // A deployment set to fixtures can hold a restored copy of real data, and calling that data
  // fake is just as misleading as presenting fixture data as real.
  const fixtureMode = getEnv().AWS_MODE === "fixtures";
  // Every role holds aws_accounts:read; ids/labels only (no connection secrets).
  const accounts = await listAccounts(ctx.org.id);
  const regions = [...new Set(accounts.flatMap((a) => a.connection?.enabledRegions ?? []))].sort();
  const synthetic = accounts.filter((a) => a.syntheticData);
  const warning = synthetic.length
    ? `Synthetic data. ${synthetic.length} of ${accounts.length} connected account(s) hold test fixture data, not data from a real AWS account.`
    : fixtureMode && accounts.length === 0
      ? "Fixture mode. This deployment is configured for test fixtures, so any account connected here will show synthetic data."
      : undefined;
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
        warning ? (
          <div role="status" className="flex items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-1.5 text-xs">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>{warning}</span>
          </div>
        ) : undefined
      }
    >
      {children}
    </AppShell>
    </LiveUpdates>
  );
}
