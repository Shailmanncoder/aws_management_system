/** Scrollable, accessible table container with caption for screen readers. */
export function TableShell({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card" role="region" aria-label={caption} tabIndex={0}>
      {children}
    </div>
  );
}
