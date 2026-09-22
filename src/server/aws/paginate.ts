/**
 * Generic token pagination with safety rails. Never assumes the first response is complete.
 *
 *  - follows `nextToken` until absent/empty
 *  - detects a repeated token (buggy/malicious loop) and stops with an error
 *  - caps pages and items so a pathological account cannot exhaust worker memory
 */
export class PaginationLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationLimitError";
  }
}

export interface PaginateOptions {
  maxPages?: number;
  maxItems?: number;
}

export async function paginate<TPage, TItem>(
  fetchPage: (token: string | undefined) => Promise<TPage>,
  extract: (page: TPage) => { items: readonly TItem[] | undefined; nextToken: string | undefined | null },
  opts: PaginateOptions = {},
): Promise<TItem[]> {
  const maxPages = opts.maxPages ?? 1000;
  const maxItems = opts.maxItems ?? 100_000;
  const seen = new Set<string>();
  const out: TItem[] = [];
  let token: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage(token);
    const { items, nextToken } = extract(res);
    if (items) {
      for (const item of items) {
        out.push(item);
        if (out.length > maxItems) throw new PaginationLimitError(`item limit ${maxItems} exceeded`);
      }
    }
    if (!nextToken) return out;
    if (seen.has(nextToken)) throw new PaginationLimitError("pagination token repeated");
    seen.add(nextToken);
    token = nextToken;
  }
  throw new PaginationLimitError(`page limit ${maxPages} exceeded`);
}
