export function Explain({ children, label = "Explain this" }: { children: React.ReactNode; label?: string }) {
  return <details className="rounded-lg border bg-muted/30 p-3 text-sm"><summary className="cursor-pointer font-medium text-primary">{label}</summary><div className="mt-2 space-y-2 leading-relaxed text-muted-foreground">{children}</div></details>;
}
