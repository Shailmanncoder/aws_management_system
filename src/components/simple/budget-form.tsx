"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
export function BudgetForm({ orgId, currency, amount, warningPercent = 80 }: { orgId: string; currency: string; amount?: number; warningPercent?: number }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(null);
    try { await api(`/api/v1/orgs/${orgId}/budget`, { body: { amount: Number(data.get("amount")), currency: String(data.get("currency")).trim().toUpperCase(), warningPercent: Number(data.get("warning")) } }); toast.success("Monthly budget saved"); router.push(`/budget?currency=${encodeURIComponent(String(data.get("currency")).trim().toUpperCase())}`); router.refresh(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }}>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm">Monthly budget<Input name="amount" type="number" min="0.01" max="1000000000" step="0.01" required defaultValue={amount} placeholder="e.g. 500" /></label>
      <label className="space-y-1 text-sm">Currency code<Input name="currency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue={currency} placeholder="USD, INR, EUR" /></label>
      <label className="space-y-1 text-sm">Warn me at (%)<Input name="warning" type="number" required min={1} max={100} step={1} defaultValue={warningPercent} /></label>
    </div>
    <p className="text-xs text-muted-foreground">One monthly budget per currency, across all workspace AWS accounts. Saving an existing currency replaces its budget and enables its alerts.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy} type="submit">{busy ? "Saving…" : "Save monthly budget"}</Button>
  </form>;
}
