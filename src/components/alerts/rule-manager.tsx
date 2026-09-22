"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api-client";

interface Rule {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  config: unknown;
}

const DESCRIBE: Record<string, string> = {
  COST_THRESHOLD: "Month-to-date spend exceeds an amount",
  COST_ANOMALY: "Latest complete day exceeds the 7-day average by a percentage",
  PUBLIC_EXPOSURE: "New public S3 bucket, open security group, public database or EKS endpoint",
  NEW_SECURITY_FINDING: "New security finding at or above a severity",
  EC2_STOPPED: "An EC2 instance entered the stopped state",
  SYNC_FAILURE: "A sync failed or completed partially",
  CONFIG_CHANGE: "Watched resource types were added or removed",
};

export function RuleManager({ orgId, rules, canManage }: { orgId: string; rules: Rule[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api(`/api/v1/orgs/${orgId}/alert-rules/recommended`, { method: "POST" }), "Recommended rules enabled")}>
            Enable recommended rules
          </Button>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount);
              if (!Number.isFinite(n) || n <= 0) return;
              void run(() => api(`/api/v1/orgs/${orgId}/alert-rules`, { body: { type: "COST_THRESHOLD", name: `Month-to-date spend over ${n} USD`, enabled: true, config: { monthToDateAmount: n, currency: "USD" } } }), "Budget alert created").then(() => setAmount(""));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="budget">Monthly budget alert (USD)</Label>
              <Input id="budget" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-40" placeholder="e.g. 5000" />
            </div>
            <Button size="sm" type="submit" disabled={busy || !amount}>Add</Button>
          </form>
        </div>
      )}
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alert rules yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{DESCRIBE[r.type] ?? r.type} · delivered in-app</p>
              </div>
              <Switch
                checked={r.enabled}
                disabled={!canManage || busy}
                aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`}
                onCheckedChange={(v) => void run(() => api(`/api/v1/orgs/${orgId}/alert-rules/${r.id}`, { method: "PATCH", body: { enabled: v } }), v ? "Rule enabled" : "Rule disabled")}
              />
              {canManage && (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} disabled={busy} onClick={() => void run(() => api(`/api/v1/orgs/${orgId}/alert-rules/${r.id}`, { method: "DELETE" }), "Rule deleted")}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Email, Slack and webhook delivery are not enabled: outbound webhooks to user-supplied URLs require an egress allow-list (SSRF protection). Alerts never include credentials or raw AWS responses.</p>
    </div>
  );
}
