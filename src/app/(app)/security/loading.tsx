export default function Loading() {
  return <div role="status" aria-label="Loading security findings" className="space-y-4">
    <p className="text-sm text-muted-foreground">Loading security findings…</p>
    {[0, 1, 2].map((key) => <div key={key} className="h-32 animate-pulse rounded-lg bg-muted" />)}
  </div>;
}
