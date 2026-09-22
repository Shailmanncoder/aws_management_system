/** Definition-list helper for detail pages. Values render as inert text. */
export function KeyValue({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={`grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr] ${className ?? ""}`}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v === null || v === undefined || v === "" ? <span className="text-muted-foreground">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}
