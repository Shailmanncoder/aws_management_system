import { cn } from "@/lib/utils";

export interface BarListItem {
  label: string;
  value: number;
  display: string;
  href?: string;
  color?: string;
  icon?: React.ReactNode;
}

/**
 * Horizontal bar list for categorical magnitude (one measure → one hue). Labels and values are
 * real text (screen-reader friendly); bars are decorative (aria-hidden).
 */
export function BarList({ items, className, ariaLabel }: { items: BarListItem[]; className?: string; ariaLabel: string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className={cn("space-y-1.5", className)} aria-label={ariaLabel}>
      {items.map((i) => {
        const pct = max > 0 && i.value > 0 ? Math.max(1, (i.value / max) * 100) : 0;
        const label = (
          <span className="flex min-w-0 items-center gap-1.5">
            {i.icon}
            <span className="truncate">{i.label}</span>
          </span>
        );
        return (
          <li key={i.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[minmax(0,13rem)_1fr_auto]" title={`${i.label}: ${i.display}`}>
            {i.href ? (
              <a href={i.href} className="min-w-0 hover:underline">
                {label}
              </a>
            ) : (
              label
            )}
            <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
              <span className="block h-full rounded-sm" style={{ width: `${pct}%`, background: i.color ?? "var(--chart-1)" }} />
            </span>
            <span className="tabular text-right text-xs font-medium">{i.display}</span>
          </li>
        );
      })}
    </ul>
  );
}
