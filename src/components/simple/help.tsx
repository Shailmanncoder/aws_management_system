"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { HELP_PERMISSION, helpHref, type HelpKind } from "@/lib/simple";
import { hasPermission, type Role } from "@/lib/rbac";
import { toast } from "sonner";
export function HelpForm({ orgId, issues, members, selected }: { orgId: string; issues: { id: string; kind: HelpKind; title: string }[]; members: { userId: string; role: Role; name: string }[]; selected?: string }) {
  const [issueKey, setIssueKey] = useState(selected ?? ""), [busy,setBusy] = useState(false), [error,setError] = useState<string | null>(null);
  const issue = issues.find(a => `${a.kind}:${a.id}` === issueKey), router = useRouter();
  const eligible = issue ? members.filter(m => hasPermission(m.role, HELP_PERMISSION[issue.kind])) : [];
  return <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={async e => { e.preventDefault(); if (!issue) return; const data = new FormData(e.currentTarget); setBusy(true); setError(null); try { await api(`/api/v1/orgs/${orgId}/help`, { body: { kind: issue.kind, targetId: issue.id, assigneeId: data.get("assignee"), note: data.get("note") } }); toast.success("Help request assigned in Stratus"); router.refresh(); } catch(err) { setError(errorMessage(err)); } finally { setBusy(false); } }}>
    <h2 className="text-lg font-semibold">Ask a teammate for help</h2>
    <label className="block space-y-1 text-sm">Issue<select className="w-full rounded-md border bg-background p-2" value={issueKey} required onChange={e => setIssueKey(e.target.value)}><option value="">Choose an issue</option>{issues.map(a => <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>{a.title}</option>)}</select></label>
    <label className="block space-y-1 text-sm">Assign to<select key={issueKey} name="assignee" className="w-full rounded-md border bg-background p-2" required defaultValue=""><option value="">Choose a teammate</option>{eligible.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
    {issue && !eligible.length && <p className="text-sm text-muted-foreground">No workspace members can view this issue. Ask an administrator to update team access.</p>}
    <label className="block space-y-1 text-sm">What do you need help with?<textarea name="note" className="min-h-24 w-full rounded-md border bg-background p-2" maxLength={1000} placeholder="Please review whether we still need this resource. Do not include passwords or secrets." /></label>
    {issue && <p className="text-sm text-muted-foreground">The request includes a <Link href={helpHref(issue.kind, issue.id)} className="underline">link to this issue and its evidence</Link>. It appears in Team help; no email or chat message is sent.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !issue || !eligible.length} type="submit">{busy ? "Assigning…" : "Assign help request"}</Button>
  </form>;
}
export function HelpStatus({ orgId, id, status }: { orgId: string; id: string; status: string }) {
  const [busy, setBusy] = useState(false), [error,setError] = useState<string | null>(null), router = useRouter();
  return <div><Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await api(`/api/v1/orgs/${orgId}/help/${id}`, { method: "PATCH", body: { status: status === "DONE" ? "OPEN" : "DONE" } }); router.refresh(); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>{busy ? "Saving…" : status === "DONE" ? "Reopen request" : "Mark request complete"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
