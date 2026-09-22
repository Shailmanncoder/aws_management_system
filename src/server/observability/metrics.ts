/**
 * Minimal in-process metrics registry (counters + latency summaries) with a shape that maps
 * directly onto OpenTelemetry instruments. Swap `emit` for an OTel meter to export.
 *
 * Tracked: API latency, AWS API latency, AWS throttling counts, job outcomes, error rates.
 */

interface Summary {
  count: number;
  sum: number;
  max: number;
}

const counters = new Map<string, number>();
const summaries = new Map<string, Summary>();

function key(name: string, labels: Record<string, string | number>): string {
  const l = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${name}{${l}}`;
}

export function incCounter(name: string, labels: Record<string, string | number> = {}, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function observe(name: string, labels: Record<string, string | number>, value: number): void {
  const k = key(name, labels);
  const s = summaries.get(k) ?? { count: 0, sum: 0, max: 0 };
  s.count += 1;
  s.sum += value;
  s.max = Math.max(s.max, value);
  summaries.set(k, s);
}

export function recordApiLatency(operation: string, status: number, durationMs: number): void {
  const statusClass = `${Math.floor(status / 100)}xx`;
  observe("api_request_duration_ms", { operation, status: statusClass }, durationMs);
  if (status >= 500) incCounter("api_errors_total", { operation });
}

export function recordAwsCall(service: string, operation: string, durationMs: number, outcome: string): void {
  observe("aws_api_duration_ms", { service, operation }, durationMs);
  incCounter("aws_api_calls_total", { service, outcome });
  if (outcome === "throttled") incCounter("aws_api_throttles_total", { service });
}

export function recordJobOutcome(type: string, status: string, durationMs: number): void {
  incCounter("jobs_total", { type, status });
  observe("job_duration_ms", { type }, durationMs);
}

export function snapshotMetrics() {
  return {
    counters: Object.fromEntries(counters),
    summaries: Object.fromEntries(
      [...summaries].map(([k, s]) => [k, { ...s, avg: s.count ? Math.round(s.sum / s.count) : 0 }]),
    ),
  };
}

export function resetMetricsForTests(): void {
  counters.clear();
  summaries.clear();
}
