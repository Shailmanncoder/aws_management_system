import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { formatRelative } from "@/lib/format";

export function SyncStatusText({ status, lastSyncedAt, error }: { status: string; lastSyncedAt: string | null; error?: string | null }) {
  const when = lastSyncedAt ? formatRelative(lastSyncedAt) : "never";
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return (
        <span className="inline-flex items-center gap-1 text-sm">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {status === "RUNNING" ? "Syncing…" : "Queued"}
        </span>
      );
    case "SUCCEEDED":
      return (
        <span className="inline-flex items-center gap-1 text-sm" title={lastSyncedAt ?? undefined}>
          <CheckCircle2 className="size-3.5 text-success-text" aria-hidden /> {when}
        </span>
      );
    case "PARTIAL":
      return (
        <span className="inline-flex items-center gap-1 text-sm" title={error ?? undefined}>
          <AlertTriangle className="size-3.5 text-status-serious" aria-hidden /> Partial · {when}
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 text-sm" title={error ?? undefined}>
          <XCircle className="size-3.5 text-status-critical" aria-hidden /> Failed · {when}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="size-3.5" aria-hidden /> Never synced
        </span>
      );
  }
}
