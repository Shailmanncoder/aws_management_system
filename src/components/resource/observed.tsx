import type { Observed } from "@/lib/resource-types";

/** Renders an observed config value or an explicit "unknown" with the reason. */
export function ObservedValue<T>({ value, render }: { value: Observed<T>; render: (v: T) => React.ReactNode }) {
  if (!value.ok) {
    const why = value.reason === "access_denied" ? "access denied" : value.reason === "not_found" ? "not found" : "unavailable";
    return <span className="text-muted-foreground" title={`Could not read this setting: ${why}`}>unknown ({why})</span>;
  }
  return <>{render(value.value)}</>;
}
