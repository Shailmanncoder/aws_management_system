import { CircleDot, CirclePause, CircleStop, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, { icon: typeof CircleDot; cls: string }> = {
  running: { icon: CircleDot, cls: "text-success-text" },
  available: { icon: CircleDot, cls: "text-success-text" },
  active: { icon: CircleDot, cls: "text-success-text" },
  ACTIVE: { icon: CircleDot, cls: "text-success-text" },
  "in-use": { icon: CircleDot, cls: "text-success-text" },
  associated: { icon: CircleDot, cls: "text-success-text" },
  stopped: { icon: CircleStop, cls: "text-muted-foreground" },
  unassociated: { icon: CircleStop, cls: "text-status-serious" },
  stopping: { icon: Loader2, cls: "text-muted-foreground" },
  pending: { icon: Loader2, cls: "text-muted-foreground" },
};

/** Resource state with icon + text (never colour alone). */
export function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-muted-foreground">—</span>;
  const s = MAP[state] ?? { icon: CirclePause, cls: "text-muted-foreground" };
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm")}>
      <Icon className={cn("size-3.5", s.cls)} aria-hidden />
      <span>{state}</span>
    </span>
  );
}
