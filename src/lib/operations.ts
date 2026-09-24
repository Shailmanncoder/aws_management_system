import { z } from "zod";
import { configurationSchema } from "./provisioning";
import type { Permission } from "./rbac";

export const RECORD_KINDS = ["VIEW", "OWNER", "BASELINE", "ENVIRONMENT", "INCIDENT", "TEMPLATE", "SAVING", "NOTIFICATION", "REMINDER"] as const;
export type RecordKind = typeof RECORD_KINDS[number];
const text = z.string().trim().min(1).max(100);
const resourceIds = z.array(z.uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "Choose each resource once");
export const recordInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("VIEW"), name: text, shared: z.boolean(), payload: z.strictObject({ path: z.enum(["/resources", "/cloud/ec2", "/cloud/s3", "/cloud/network", "/cloud/databases", "/cloud/serverless", "/cloud/containers"]), query: z.string().max(6000) }) }),
  z.strictObject({ kind: z.literal("OWNER"), name: text, payload: z.strictObject({ resourceId: z.uuid(), owner: text, team: z.string().trim().max(100).default(""), projectId: z.uuid().optional() }) }),
  z.strictObject({ kind: z.literal("BASELINE"), name: text, payload: z.strictObject({ resourceId: z.uuid() }) }),
  z.strictObject({ kind: z.literal("ENVIRONMENT"), name: text, payload: z.strictObject({ tagKey: text, tagValue: text }) }),
  z.strictObject({ kind: z.literal("INCIDENT"), name: text, payload: z.strictObject({ resourceIds, assigneeId: z.uuid(), status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED"]), note: z.string().trim().max(4000), tasks: z.array(z.strictObject({ title: text, done: z.boolean() })).max(30).default([]) }) }),
  z.strictObject({ kind: z.literal("TEMPLATE"), name: text, payload: configurationSchema }),
  z.strictObject({ kind: z.literal("SAVING"), name: text, payload: z.strictObject({ findingId: z.uuid() }) }),
  z.strictObject({ kind: z.literal("NOTIFICATION"), name: text, payload: z.strictObject({ memberId: z.uuid(), ruleId: z.uuid().optional(), enabled: z.boolean().default(true) }) }),
  z.strictObject({ kind: z.literal("REMINDER"), name: text, payload: z.strictObject({ resourceId: z.uuid().optional(), dueAt: z.iso.datetime(), daysBefore: z.number().int().min(0).max(365).default(30), note: z.string().max(500).default("") }) }),
]);
export type RecordInput = z.infer<typeof recordInput>;
export const READ_PERMISSION: Record<RecordKind, Permission> = { VIEW: "inventory:read", OWNER: "inventory:read", BASELINE: "inventory:read", ENVIRONMENT: "inventory:read", INCIDENT: "operations:manage", TEMPLATE: "provisioning:create", SAVING: "optimization:read", NOTIFICATION: "alerts:manage", REMINDER: "inventory:read" };
export const WRITE_PERMISSION: Record<RecordKind, Permission> = { ...READ_PERMISSION, OWNER: "operations:manage", BASELINE: "operations:manage", ENVIRONMENT: "operations:manage", SAVING: "optimization:manage", REMINDER: "operations:manage" };
export const operationInput = z.strictObject({
  name: text,
  resourceIds,
  action: z.enum(["start", "stop", "reboot", "tag"]),
  tags: z.array(z.strictObject({ key: z.string().min(1).max(128).refine(v => !v.toLowerCase().startsWith("aws:"), "AWS tags are reserved"), value: z.string().max(256) })).max(20).default([]),
  scheduledAt: z.iso.datetime().optional(),
  timezone: z.string().max(80).default("UTC").refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Choose a valid time zone"),
}).superRefine((v, ctx) => {
  if (v.action === "tag" && !v.tags.length) ctx.addIssue({ code: "custom", message: "Add at least one tag" });
  if (new Set(v.tags.map(t => t.key)).size !== v.tags.length) ctx.addIssue({ code: "custom", message: "Duplicate tags" });
  if (v.scheduledAt && !["start", "stop"].includes(v.action)) ctx.addIssue({ code: "custom", message: "Only start and stop actions can be scheduled" });
});
export type OperationInput = z.infer<typeof operationInput>;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function changedFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>, b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => stableJson(a[key]) !== stableJson(b[key]));
}
export function resourceSnapshot(r: { name: string | null; state: string | null; attributes: unknown; tags: { key: string; value: string }[]; deletedAt?: Date | null }) {
  return { name: r.name, state: r.state, attributes: r.attributes, tags: Object.fromEntries(r.tags.map(t => [t.key, t.value])), deleted: !!r.deletedAt };
}
export function interpretInventorySearch(input: string) {
  const value = input.toLowerCase().trim();
  const filters: Record<string, string> = {};
  const understood: string[] = [];
  const match = (expression: RegExp, key: string, filter: string) => { if (expression.test(value)) { filters[key] = filter; understood.push(filter); } };
  match(/\b(servers?|instances?|ec2)\b/, "type", "ec2:instance");
  match(/\b(buckets?|s3)\b/, "type", "s3:bucket");
  match(/\brunning\b/, "state", "running");
  match(/\bstopped\b/, "state", "stopped");
  match(/\bproduction\b/, "tag", "env=production");
  match(/\bstaging\b/, "tag", "env=staging");
  match(/\bdevelopment\b/, "tag", "env=development");
  match(/\b(without|missing|no) (an? )?owner\b/, "unowned", "true");
  const region = value.match(/\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/);
  if (region) filters.region = region[0];
  return { filters, understood, supported: Object.keys(filters).length > 0 };
}
