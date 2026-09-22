import { AlertOctagon, AlertTriangle, Info, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

export type SeverityValue = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

export const SEVERITY_ORDER: SeverityValue[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];

const MAP: Record<SeverityValue, { label: string; icon: typeof Info; cls: string; color: string }> = {
  CRITICAL: { label: "Critical", icon: AlertOctagon, cls: "border-status-critical/50 bg-status-critical/10", color: "var(--status-critical)" },
  HIGH: { label: "High", icon: ShieldAlert, cls: "border-status-serious/50 bg-status-serious/10", color: "var(--status-serious)" },
  MEDIUM: { label: "Medium", icon: AlertTriangle, cls: "border-status-warning/60 bg-status-warning/10", color: "var(--status-warning)" },
  LOW: { label: "Low", icon: ShieldQuestion, cls: "border-border bg-muted", color: "var(--chart-1)" },
  INFORMATIONAL: { label: "Info", icon: Info, cls: "border-border bg-muted", color: "var(--chart-axis)" },
};

export const severityColor = (s: SeverityValue) => MAP[s].color;
export const severityLabel = (s: SeverityValue) => MAP[s].label;

/** Severity is always icon + text; colour is supplementary. */
export function SeverityBadge({ severity, className }: { severity: SeverityValue; className?: string }) {
  const m = MAP[severity];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", m.cls, className)}>
      <Icon className="size-3.5" aria-hidden style={{ color: m.color }} />
      {m.label}
    </span>
  );
}
