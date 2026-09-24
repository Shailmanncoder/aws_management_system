export interface InventoryView {
  id: string;
  name: string;
  query: string;
}

export const MAX_INVENTORY_VIEWS = 20;
const KEYS = ["account", "region", "type", "state", "q", "tag", "vpc", "instanceType", "sort", "dir", "pageSize", "unowned"];

/** Keep only inventory controls; opening a view always starts on page one. */
export function inventoryViewQuery(query: string): string {
  const source = new URLSearchParams(query);
  const result = new URLSearchParams();
  for (const key of KEYS) {
    const value = source.get(key);
    if (value && value.length <= 512) result.set(key, value);
  }
  return result.toString();
}

export function inventoryViewStorageKey(userId: string, orgId: string, pathname: string): string {
  return `stratus:inventory-views:${JSON.stringify([userId, orgId, pathname])}`;
}

export function readInventoryViews(raw: string | null): InventoryView[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const views: InventoryView[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id || entry.id.length > 100 ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 60 || typeof entry.query !== "string" || entry.query.length > 6000 ||
        views.some((view) => view.id === entry.id)) continue;
      views.push({ id: entry.id, name: entry.name.trim(), query: inventoryViewQuery(entry.query) });
      if (views.length === MAX_INVENTORY_VIEWS) break;
    }
    return views;
  } catch {
    return [];
  }
}
