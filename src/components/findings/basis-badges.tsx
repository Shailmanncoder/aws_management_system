import { cn } from "@/lib/utils";

const BASIS: Record<string, { label: string; title: string; cls: string }> = {
  CONFIRMED: { label: "Confirmed", title: "Fact taken directly from AWS configuration", cls: "border-status-good/40 bg-status-good/10" },
  HEURISTIC: { label: "Heuristic", title: "Rule of thumb from observed signals — validate before acting", cls: "border-status-warning/60 bg-status-warning/10" },
  ESTIMATED: { label: "Estimated savings", title: "Savings computed from public list prices and observed usage", cls: "border-chart-1/40 bg-chart-1/10" },
};

export function BasisBadge({ basis }: { basis: string }) {
  const b = BASIS[basis] ?? BASIS.HEURISTIC!;
  return <span title={b.title} className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", b.cls)}>{b.label}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  return <span className="inline-flex rounded-full border px-2 py-0.5 text-xs">{confidence.toLowerCase()} confidence</span>;
}
