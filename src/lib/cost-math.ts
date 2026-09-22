/**
 * Pure cost analytics (client-safe, unit-tested). All inputs are AWS-reported amounts; derived
 * values (projections, percentage changes) are labelled as such in the UI.
 */

export const RANGE_PRESETS = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "3m": { label: "Last 3 months", days: 91 },
  "6m": { label: "Last 6 months", days: 182 },
  "12m": { label: "Last 12 months", days: 365 },
} as const;
export type RangePreset = keyof typeof RANGE_PRESETS;

const DAY = 86_400_000;

export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Inclusive [start, end] UTC days for a preset or a validated custom range. */
export function resolveRange(preset: RangePreset | "custom", now: Date, custom?: { from: string; to: string }): { start: Date; end: Date } {
  const today = utcDay(now);
  if (preset === "custom" && custom) {
    const start = new Date(`${custom.from}T00:00:00Z`);
    const end = new Date(`${custom.to}T00:00:00Z`);
    return { start, end: end > today ? today : end };
  }
  const days = RANGE_PRESETS[preset === "custom" ? "30d" : preset].days;
  return { start: new Date(today.getTime() - (days - 1) * DAY), end: today };
}

export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Linear month-end projection from month-to-date spend. Returns null when there is too little
 * data (fewer than 3 complete days) to project responsibly.
 */
export function projectMonthEnd(mtdTotal: number, completeDays: number, now: Date): number | null {
  if (completeDays < 3) return null;
  return (mtdTotal / completeDays) * daysInMonth(now);
}

/** Top-N categories by value with the remainder folded into "Other" (never more hues than slots). */
export function topNWithOther<T extends { key: string; amount: number }>(rows: T[], n: number): { key: string; amount: number }[] {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, n).map((r) => ({ key: r.key, amount: r.amount }));
  const rest = sorted.slice(n).reduce((s, r) => s + r.amount, 0);
  return rest > 0.005 ? [...head, { key: "Other", amount: rest }] : head;
}

/** Fills missing days with null (not 0) so gaps are visible rather than fabricated. */
export function fillDays(points: { day: string; amount: number; estimated: boolean }[], start: Date, end: Date) {
  const map = new Map(points.map((p) => [p.day, p]));
  const out: { day: string; amount: number | null; estimated: boolean }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    const p = map.get(day);
    out.push({ day, amount: p ? p.amount : null, estimated: p?.estimated ?? false });
  }
  return out;
}

export const SERVICE_SHORT_NAMES: Record<string, string> = {
  "Amazon Elastic Compute Cloud - Compute": "EC2 compute",
  "EC2 - Other": "EC2 other",
  "Amazon Relational Database Service": "RDS",
  "Amazon Simple Storage Service": "S3",
  "Amazon Elastic Container Service": "ECS",
  "Amazon Elastic Kubernetes Service": "EKS",
  "Amazon DynamoDB": "DynamoDB",
  "Amazon CloudFront": "CloudFront",
  "Amazon Virtual Private Cloud": "VPC",
  "AmazonCloudWatch": "CloudWatch",
  "Amazon CloudWatch": "CloudWatch",
  "AWS Lambda": "Lambda",
  "Elastic Load Balancing": "ELB",
};

export const shortService = (s: string) => SERVICE_SHORT_NAMES[s] ?? s.replace(/^(Amazon|AWS)\s+/, "");
