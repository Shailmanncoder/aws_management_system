"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";

export function FindingAction({ orgId, findingId, suppressed, kind = "security" }: { orgId: string; findingId: string; suppressed: boolean; kind?: "security" | "optimization" }) {
  const opt = kind === "optimization";
  const router = useRouter();
  const inputId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="space-y-2 max-w-xl" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(null);
    try {
      await api(`/api/v1/orgs/${orgId}/${kind}/${findingId}`, { method: "PATCH", body: { status: suppressed ? "OPEN" : "SUPPRESSED", reason } });
      setReason(""); router.refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  }}>
    <label htmlFor={inputId} className="block text-sm font-medium">{suppressed ? "Reason for reopening" : opt ? "Reason for dismissing" : "Reason for accepting this risk"}</label>
    <Input id={inputId} value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required disabled={pending} />
    <p className="text-xs text-muted-foreground">{suppressed ? "Reopening returns this item to the open list." : opt ? "Dismissing hides this recommendation from future analyses. Nothing changes in AWS." : "Suppression records an accepted risk. It does not fix the issue or change AWS configuration."}</p>
    <Button type="submit" variant="outline" size="sm" disabled={pending || reason.trim().length < 5}>{pending ? "Saving…" : suppressed ? (opt ? "Reopen recommendation" : "Reopen finding") : opt ? "Dismiss recommendation" : "Suppress finding"}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
