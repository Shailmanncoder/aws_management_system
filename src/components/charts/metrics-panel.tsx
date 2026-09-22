"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, errorMessage } from "@/lib/api-client";
import { ChartCard } from "./chart-card";
import { formatValue, type ValueUnit } from "./format";
import { TimeSeries } from "./time-series";

interface Series {
  name: string;
  label: string;
  unit: ValueUnit;
  stat: string;
  points: { t: string; v: number }[];
}
type MetricsResult = { status: "ok"; series: Series[]; fetchedAt: string } | { status: "unavailable"; reason: string };

const RANGES = [
  ["1h", "Last hour"],
  ["24h", "Last 24 hours"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
] as const;

function summarize(s: Series): string {
  if (s.points.length === 0) return "No datapoints.";
  const vals = s.points.map((p) => p.v);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `${s.stat} over ${s.points.length} points: average ${formatValue(avg, s.unit)}, minimum ${formatValue(Math.min(...vals), s.unit)}, maximum ${formatValue(Math.max(...vals), s.unit)}.`;
}

/** CloudWatch graphs for a resource. Missing datapoints are shown as such — never synthesised. */
export function MetricsPanel({ orgId, resourceId, kind }: { orgId: string; resourceId: string; kind: "ec2" | "lambda" | "rds" }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("24h");
  // Results are keyed by range so a range switch shows loading without resetting state in an effect.
  const [result, setResult] = useState<{ range: string; data?: MetricsResult; error?: string } | null>(null);

  // Auto-refresh every 60s (server caches per 5 minutes, so CloudWatch is not hammered).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<MetricsResult>(`/api/v1/orgs/${orgId}/resources/${resourceId}/metrics?range=${range}`)
      .then((d) => !cancelled && setResult({ range, data: d }))
      .catch((e: unknown) => !cancelled && setResult({ range, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [orgId, resourceId, range, tick]);

  const current = result?.range === range ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const placeholderCount = kind === "ec2" ? 6 : kind === "lambda" ? 4 : 3;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">CloudWatch metrics, fetched on demand and cached for 5 minutes.</p>
        <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <SelectTrigger className="h-8 w-40" aria-label="Metrics time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {data?.status === "unavailable" && (
        <Alert>
          <AlertDescription>Monitoring data unavailable: {data.reason}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!data &&
          Array.from({ length: placeholderCount }, (_, i) => (
            <ChartCard key={i} title="Loading…" state={error ? { kind: "error", message: error } : { kind: "loading" }} height={160} />
          ))}
        {data?.status === "ok" &&
          data.series.map((s) => (
            <ChartCard
              key={s.name}
              title={s.label}
              description={`${s.name} · ${s.stat}`}
              height={160}
              state={s.points.length === 0 ? { kind: "empty", message: "No datapoints in this range (resource stopped, or metric not published)." } : { kind: "ready" }}
              summary={summarize(s)}
              table={
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th scope="col" className="py-1">Time</th>
                      <th scope="col" className="py-1 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.points.slice(-200).map((p) => (
                      <tr key={p.t} className="border-t">
                        <td className="py-1">{new Date(p.t).toLocaleString()}</td>
                        <td className="tabular py-1 text-right">{formatValue(p.v, s.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <TimeSeries data={s.points} unit={s.unit} label={s.label} />
            </ChartCard>
          ))}
      </div>
    </div>
  );
}
