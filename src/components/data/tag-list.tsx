export function TagList({ tags, max = 3 }: { tags: { key: string; value: string }[]; max?: number }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = tags.filter((t) => t.key !== "Name").slice(0, max);
  const rest = tags.filter((t) => t.key !== "Name").length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <span key={t.key} className="max-w-40 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]" title={`${t.key}=${t.value}`}>
          {t.key}={t.value}
        </span>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </span>
  );
}
