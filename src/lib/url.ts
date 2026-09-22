export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Builds a same-app relative href from current params plus overrides (null removes a key). */
export function buildHref(pathname: string, current: SearchParamsRecord, overrides: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "") p.set(k, value);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
