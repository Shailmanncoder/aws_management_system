import "server-only";
import { getDb } from "../db";

/**
 * Tenant-scoped read cache for derived dashboard data (never credentials).
 *
 * Keys are ALWAYS `org:{organizationId}:v{inventoryVersion}:{namespace}:{...dims}` — built by
 * this module, never by callers — so tenants can never share entries. `inventoryVersion` is
 * bumped after every sync/disconnect, which invalidates every instance's cache without pub/sub.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_ENTRIES = 2_000;
const store = new Map<string, Entry>();

async function orgVersion(organizationId: string): Promise<number> {
  // Always read the current version (single primary-key lookup): live updates re-render as soon
  // as the version changes, so a memoised version would briefly serve stale data.
  const org = await getDb().organization.findUnique({ where: { id: organizationId }, select: { inventoryVersion: true } });
  return org?.inventoryVersion ?? 0;
}

export function cacheKey(organizationId: string, version: number, namespace: string, dims: readonly (string | number | null | undefined)[]): string {
  const safe = dims.map((d) => encodeURIComponent(String(d ?? "")));
  return `org:${organizationId}:v${version}:${namespace}:${safe.join(":")}`;
}

export async function cached<T>(
  organizationId: string,
  namespace: string,
  dims: readonly (string | number | null | undefined)[],
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(organizationId, await orgVersion(organizationId), namespace, dims);
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await compute();
  if (store.size >= MAX_ENTRIES) {
    // Evict oldest insertion (Map preserves insertion order).
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Explicit invalidation after sync (in addition to the version bump). */
export function invalidateOrg(organizationId: string): void {
  for (const key of store.keys()) if (key.startsWith(`org:${organizationId}:`)) store.delete(key);
}

export function clearCacheForTests(): void {
  store.clear();
}
