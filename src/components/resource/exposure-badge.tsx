import { Globe, HelpCircle, Lock, ShieldAlert } from "lucide-react";
import { EXPOSURE_LABELS, type ExposureLevel } from "@/lib/s3-posture";
import { cn } from "@/lib/utils";

const MAP: Record<ExposureLevel, { icon: typeof Globe; cls: string }> = {
  public: { icon: Globe, cls: "border-status-critical/50 bg-status-critical/10" },
  "not-blocked": { icon: ShieldAlert, cls: "border-status-warning/60 bg-status-warning/10" },
  blocked: { icon: Lock, cls: "border-status-good/40 bg-status-good/10" },
  unknown: { icon: HelpCircle, cls: "border-border bg-muted" },
};

export function ExposureBadge({ level, title }: { level: ExposureLevel; title?: string }) {
  const m = MAP[level];
  const Icon = m.icon;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>
      <Icon className="size-3.5" aria-hidden /> {EXPOSURE_LABELS[level]}
    </span>
  );
}
