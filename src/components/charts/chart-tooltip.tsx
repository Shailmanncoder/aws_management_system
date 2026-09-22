"use client";

/** Tooltip body shared by all charts: text in ink tokens, series identity via a colour chip. */
export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="inline-block size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          <span>{r.label}</span>
          <span className="ml-auto tabular font-medium text-popover-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
