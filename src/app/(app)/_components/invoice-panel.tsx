import { formatCurrency, formatDate } from "@/lib/format";
import type { OrgAccess } from "@/server/authz/guard";
import { getInvoiceOverview } from "@/server/services/invoice-service";

export async function InvoicePanel({ access, account, compact = false }: { access: OrgAccess; account?: string; compact?: boolean }) {
  const accounts = await getInvoiceOverview(access, account);
  return <section aria-label="AWS invoices" className="rounded-lg border bg-card p-4 space-y-3">
    <h2 className="text-sm font-semibold">AWS bills · payment currency</h2>
    <p className="text-xs text-muted-foreground">Actual issued invoice totals, including tax, in the currency AWS specifies for payment. Country does not override your billing settings. Consolidated invoices may cover multiple accounts; these amounts are not added to usage totals. Invoices are account-wide and are not filtered by region.</p>
    {accounts.length === 0 && <p className="text-sm text-muted-foreground">Connect an account to load its invoices.</p>}
    {accounts.map((a) => <div key={a.id} className="space-y-2">
      <h3 className="text-sm font-medium">{a.name}</h3>
      {(a.error || a.stale) && <p className="text-xs text-muted-foreground">{a.error ?? (!a.syncedAt ? "Invoice details have not been synced. Run a cost refresh." : "Invoice data is stale; run a cost refresh.")}</p>}
      {a.syncedAt && !a.error && a.invoices.length === 0 && <p className="text-xs text-muted-foreground">No issued invoices returned for this account in the past 13 months.</p>}
      {a.invoices.slice(0, compact ? 1 : 12).map((i) => <div key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-2 text-sm">
        <span>{i.period} · {i.type} <span className="text-xs text-muted-foreground">{i.id} · {formatDate(i.issuedAt)}</span></span>
        <strong className="tabular-nums">{formatCurrency(Number(i.amount), i.currency)}</strong>
      </div>)}
      {!compact && a.invoices.length > 12 && <p className="text-xs text-muted-foreground">Showing the 12 most recently issued invoices for this account.</p>}
    </div>)}
  </section>;
}
