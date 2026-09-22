import { AlertTriangle, CheckCircle2, CircleDashed, CircleOff, KeyRound, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionStatusValue } from "@/lib/types";

const MAP: Record<ConnectionStatusValue, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  CONNECTED: { label: "Connected", icon: CheckCircle2, tone: "text-success-text border-status-good/40 bg-status-good/10" },
  NEEDS_ATTENTION: { label: "Needs attention", icon: AlertTriangle, tone: "border-status-warning/50 bg-status-warning/10" },
  PERMISSION_PROBLEM: { label: "Permission problem", icon: ShieldAlert, tone: "border-status-serious/50 bg-status-serious/10" },
  CONNECTION_FAILED: { label: "Connection failed", icon: XCircle, tone: "border-status-critical/40 bg-status-critical/10" },
  ROLE_UNAVAILABLE: { label: "Role unavailable", icon: KeyRound, tone: "border-status-critical/40 bg-status-critical/10" },
  PENDING: { label: "Setup pending", icon: CircleDashed, tone: "border-border bg-muted" },
  DISCONNECTED: { label: "Disconnected", icon: CircleOff, tone: "border-border bg-muted" },
};

/** Status is always conveyed by icon + text, never colour alone. */
export function ConnectionStatusBadge({ status, className }: { status: ConnectionStatusValue; className?: string }) {
  const s = MAP[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", s.tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  );
}
