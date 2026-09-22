import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile. Deltas show direction with an icon + sign, never colour alone. */
export function StatTile({
  label,
  value,
  sub,
  delta,
  deltaGoodWhen = "down",
  badge,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: { pct: number | null; label: string };
  deltaGoodWhen?: "up" | "down";
  badge?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const pct = delta?.pct ?? null;
  const up = pct !== null && pct > 0.05;
  const down = pct !== null && pct < -0.05;
  const good = (up && deltaGoodWhen === "up") || (down && deltaGoodWhen === "down");
  const DIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
        </div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {delta && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", pct === null ? "" : good ? "text-success-text" : up || down ? "text-status-critical" : "")}>
              <DIcon className="size-3.5" aria-hidden />
              {pct === null ? "n/a" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
              <span className="font-normal text-muted-foreground">{delta.label}</span>
            </span>
          )}
          {sub}
          {badge}
        </div>
      </CardContent>
    </Card>
  );
}
