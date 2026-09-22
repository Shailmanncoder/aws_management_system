import type { Observed, ResourceType } from "@/lib/resource-types";
import { classifyAwsError } from "../errors";
import type { AwsSession } from "../session";

/** A normalised resource ready for persistence. `attributes` is JSON-serialisable by construction. */
export interface NormalizedResource<A = object> {
  resourceType: ResourceType;
  region: string;
  resourceId: string;
  arn: string | null;
  name: string | null;
  state: string | null;
  attributes: A;
  tags: Record<string, string>;
  /** Extra search terms (IPs, DNS names) — folded into searchText. */
  searchTerms?: string[];
}

export interface CollectorContext {
  session: AwsSession;
  region: string;
  accountId: string;
}

export interface Collector {
  /** Stable id, e.g. "ec2:instances". */
  id: string;
  /** Resource types this collector is authoritative for (used for stale-resource marking). */
  resourceTypes: ResourceType[];
  scope: "regional" | "global";
  /** IAM action surfaced to users when AWS denies the call. */
  iamAction: string;
  collect(ctx: CollectorContext): Promise<NormalizedResource[]>;
}

export const GLOBAL_REGION = "global";

export type TagList = { Key?: string; Value?: string }[] | undefined;

/** AWS tag list → bounded key/value map (caps protect the DB from pathological inputs). */
export function tagsToRecord(tags: TagList | Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tags) return out;
  const entries: [string, string][] = Array.isArray(tags)
    ? tags.filter((t): t is { Key: string; Value?: string } => typeof t.Key === "string").map((t) => [t.Key, t.Value ?? ""])
    : Object.entries(tags).map(([k, v]) => [k, v ?? ""]);
  for (const [k, v] of entries.slice(0, 60)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k.slice(0, 128)] = v.slice(0, 256);
  }
  return out;
}

export function nameTag(tags: Record<string, string>): string | null {
  return tags.Name ?? tags.name ?? null;
}

export const iso = (d: Date | string | undefined | null): string | null => {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/**
 * Runs a per-resource configuration read and records the outcome instead of throwing, so one
 * denied/missing sub-call never loses the whole resource. `notFoundValue` is used when AWS
 * reports that the configuration simply does not exist (e.g. no lifecycle rules).
 */
export async function observe<T>(fn: () => Promise<T>, notFoundValue?: { value: T }): Promise<Observed<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const cls = classifyAwsError(err);
    if (cls === "not_found" && notFoundValue) return { ok: true, value: notFoundValue.value };
    if (cls === "throttled") throw err; // bubble up to the retry wrapper
    return { ok: false, reason: cls === "access_denied" ? "access_denied" : cls === "not_found" ? "not_found" : "error" };
  }
}
