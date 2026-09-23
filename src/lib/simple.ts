import type { Permission } from "./rbac";

export const HELP_KINDS = ["security", "optimization", "sync"] as const;
export type HelpKind = (typeof HELP_KINDS)[number];
export const HELP_PERMISSION: Record<HelpKind, Permission> = {
  security: "security:read", optimization: "optimization:read", sync: "aws_accounts:read",
};
export function helpHref(kind: string, id: string) {
  return kind === "sync" ? `/settings/cloud-accounts/${id}` : kind === "security" ? `/security/${id}` : `/optimization/${id}`;
}
export const SIMPLE_LABELS: Record<string, string> = {
  "/": "Home", "/resources": "All resources", "/cloud/ec2": "Servers", "/cloud/s3": "File storage",
  "/cloud/network": "Connections", "/cloud/serverless": "On-demand tasks", "/cloud/containers": "App containers",
  "/cost": "Spending", "/optimization": "Savings", "/monitoring": "Performance", "/audit": "Activity history",
};
export type PriorityAction = { id: string; kind: HelpKind; title: string; reason: string; next: string; href: string; priority: "Urgent" | "Review soon" | "Opportunity"; checkedAt: string | null };

/** Compare only amounts in the same currency, passed by the caller. Unknown is never zero. */
export function budgetProgress(amount: number | null, limit: number, projection: number | null) {
  if (amount === null || !Number.isFinite(amount) || !Number.isFinite(limit) || limit <= 0) return { percent: null, remaining: null, status: "Waiting for spending data" };
  return { percent: Math.max(0, amount / limit * 100), remaining: limit - amount,
    status: amount >= limit ? "Over budget" : projection !== null && Number.isFinite(projection) && projection > limit ? "May exceed your budget" : amount >= limit * .8 ? "Approaching your budget" : "Within your budget so far" };
}

/** Monday-to-Monday UTC windows. offset 0 is this week, 1 is the last completed week. */
export function weekWindow(now: Date, offset = 1) {
  const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(endOfToday);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - offset * 7);
  const end = new Date(monday); end.setUTCDate(end.getUTCDate() + 7);
  return { start: monday, end: offset === 0 ? now : end };
}
