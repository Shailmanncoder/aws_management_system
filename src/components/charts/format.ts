import { formatBytes, formatCurrency, formatNumber } from "@/lib/format";

export type ValueUnit = "percent" | "bytes" | "count" | "ms" | "usd";

export function formatValue(v: number, unit: ValueUnit, compact = false): string {
  switch (unit) {
    case "percent":
      return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case "bytes":
      return formatBytes(v);
    case "ms":
      return `${formatNumber(v, { maxFractionDigits: 0 })} ms`;
    case "usd":
      return formatCurrency(v, "USD", { compact });
    default:
      return formatNumber(v, { compact, maxFractionDigits: 1 });
  }
}

export const axisTick = { fill: "var(--chart-axis)", fontSize: 11 };
export const gridProps = { stroke: "var(--chart-grid)", strokeDasharray: "2 4", vertical: false } as const;

export function shortTime(iso: string, spanMs: number): string {
  const d = new Date(iso);
  if (spanMs <= 2 * 86_400_000) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
