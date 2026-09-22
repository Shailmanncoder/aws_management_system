"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLive } from "@/components/layout/live-updates";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type SyncType = "INVENTORY_SYNC" | "COST_SYNC";

const DEFAULT_LABEL: Record<SyncType, string> = { INVENTORY_SYNC: "Refresh", COST_SYNC: "Refresh cost data" };

/**
 * Queues a fresh sync (all connected accounts, or one account when `accountId` is given).
 * Progress arrives via the live stream; the page re-renders automatically when new data lands.
 * Inventory syncs also re-run security, optimisation and alert analysis.
 */
export function RefreshNow({
  orgId,
  type = "INVENTORY_SYNC",
  accountId,
  label,
  size = "sm",
  className,
}: {
  orgId: string;
  type?: SyncType;
  accountId?: string;
  label?: string;
  size?: "sm" | "xs";
  className?: string;
}) {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const syncing = (live?.activeJobs ?? []).some((j) => j.type === type);
  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      disabled={busy || syncing}
      aria-live="polite"
      title={type === "COST_SYNC" ? "Fetch the latest Cost Explorer data (AWS updates billing about once a day)" : "Fetch the latest resources from AWS and re-run security, optimisation and alert analysis"}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await api<{ jobs: { deduplicated: boolean }[] }>(`/api/v1/orgs/${orgId}/sync`, { body: { type, ...(accountId ? { accountId } : {}) } });
          toast.success(
            res.jobs.every((j) => j.deduplicated)
              ? "A sync is already running — this page will update when it finishes."
              : "Sync started — this page updates automatically as fresh data arrives.",
          );
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden /> {syncing ? "Syncing…" : (label ?? DEFAULT_LABEL[type])}
    </Button>
  );
}
