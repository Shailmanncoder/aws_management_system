"use client";

import { Loader2, Radio, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface LiveSnapshot {
  inventoryVersion: number;
  activeJobs: { type: string; status: string; account: string | null }[];
  lastFinishedAt: string | null;
  openAlerts: number;
}

const LiveContext = createContext<LiveSnapshot | null>(null);
export const useLive = () => useContext(LiveContext);

const JOB_LABELS: Record<string, string> = {
  INVENTORY_SYNC: "inventory",
  COST_SYNC: "cost",
  SECURITY_SCAN: "security",
  OPTIMIZATION_ANALYSIS: "optimisation",
  METRICS_COLLECTION: "metrics",
  ALERT_EVALUATION: "alerts",
};

/**
 * Subscribes to the workspace live stream (Server-Sent Events). When the data version or job
 * state changes, the current page's server components are re-rendered in place.
 */
export function LiveUpdates({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const prev = useRef<{ version: number; active: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const es = new EventSource(`/api/v1/orgs/${orgId}/live`);
    es.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as LiveSnapshot;
      setSnap(data);
      const p = prev.current;
      prev.current = { version: data.inventoryVersion, active: data.activeJobs.length };
      if (p && (p.version !== data.inventoryVersion || p.active !== data.activeJobs.length)) {
        clearTimeout(pending.current);
        pending.current = setTimeout(() => router.refresh(), 400);
      }
    });
    // EventSource reconnects automatically (server sends retry: 5000).
    return () => {
      es.close();
      clearTimeout(pending.current);
    };
  }, [orgId, router]);

  return <LiveContext.Provider value={snap}>{children}</LiveContext.Provider>;
}

export function LiveIndicator() {
  const snap = useLive();
  if (!snap) {
    return (
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
        <WifiOff className="size-3.5" aria-hidden /> Connecting…
      </span>
    );
  }
  const running = snap.activeJobs;
  const label = running.length
    ? `Syncing ${[...new Set(running.map((j) => JOB_LABELS[j.type] ?? j.type))].join(", ")}`
    : "Live";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="status" aria-live="polite" className="hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs sm:inline-flex">
          {running.length ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Radio className="size-3.5 text-success-text" aria-hidden />}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {running.length
          ? running.map((j) => `${j.account ?? "workspace"}: ${JOB_LABELS[j.type] ?? j.type} (${j.status.toLowerCase()})`).join(" · ")
          : snap.lastFinishedAt
            ? `Up to date · last sync finished ${new Date(snap.lastFinishedAt).toLocaleTimeString()}`
            : "Waiting for the first sync"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Alerts bell with a live open-alerts count. */
export function LiveAlertsCount({ initial }: { initial: number }) {
  const snap = useLive();
  const n = snap?.openAlerts ?? initial;
  if (n <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-status-critical px-1 text-[10px] font-semibold text-white" aria-hidden>
      {n > 99 ? "99+" : n}
    </span>
  );
}
