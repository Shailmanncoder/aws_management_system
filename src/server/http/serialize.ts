import "server-only";

/** Converts server objects (Dates, Decimals) into plain JSON for client component props. */
export function toClient<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
