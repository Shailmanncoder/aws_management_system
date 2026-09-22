import { AlertTriangle, Clock } from "lucide-react";

export function CoverageBanner({ coverage }: { coverage: { name: string; status: string; message: string | null }[] }) {
  const issues = coverage.filter((c) => c.status !== "available");
  if (issues.length === 0) return null;
  return (
    <div role="status" className="space-y-1 rounded-lg border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-sm">
      <p className="font-medium">Cost data is incomplete for {issues.length} account{issues.length > 1 ? "s" : ""}:</p>
      <ul className="space-y-0.5">
        {issues.map((c) => (
          <li key={c.name} className="flex items-start gap-1.5">
            {c.status === "pending" ? <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
            <span>
              <strong>{c.name}</strong>: {c.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
