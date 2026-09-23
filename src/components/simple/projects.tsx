"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
type Project = { id: string; name: string; owner: string; description: string; accountIds: string[]; totals: { currency: string; amount: number }[]; resourceCount: number };
export function Projects({ orgId, projects, accounts, canManage, canReadCosts, canReadResources }: { orgId: string; projects: Project[]; accounts: { id: string; displayName: string }[]; canManage: boolean; canReadCosts: boolean; canReadResources: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Project | "new" | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [removing, setRemoving] = useState<string | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  return <div className="space-y-5">
    {canManage && !editing && <Button onClick={() => { setError(null); setEditing("new"); }}>Create business project</Button>}
    {editing && <form key={current?.id ?? "new"} className="space-y-4 rounded-xl border bg-card p-5" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(null);
      try { await api(`/api/v1/orgs/${orgId}/projects${current ? `/${current.id}` : ""}`, { method: current ? "PATCH" : "POST", body: { name: data.get("name"), owner: data.get("owner"), description: data.get("description"), accountIds: data.getAll("accounts") } }); setEditing(null); toast.success("Project saved"); router.refresh(); } catch(err) { setError(errorMessage(err)); } finally { setBusy(false); }
    }}><h2 className="text-lg font-semibold">{current ? "Edit project" : "New business project"}</h2>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Project name<Input name="name" required minLength={2} maxLength={80} defaultValue={current?.name} placeholder="Company website" /></label><label className="text-sm">Person or team responsible<Input name="owner" required minLength={2} maxLength={100} defaultValue={current?.owner} placeholder="Website team" /></label></div>
      <label className="block text-sm">Description<Input name="description" maxLength={500} defaultValue={current?.description} placeholder="What is this project used for?" /></label>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Include these AWS accounts</legend>{!accounts.length && <p className="text-sm text-muted-foreground">Connect an AWS account first, or save an empty project for later.</p>}{accounts.map(a => { const taken = projects.find(p => p.id !== current?.id && p.accountIds.includes(a.id)); return <label key={a.id} className="flex items-center gap-2 text-sm"><input name="accounts" type="checkbox" value={a.id} defaultChecked={current?.accountIds.includes(a.id)} disabled={!!taken || busy} />{a.displayName}{taken && <span className="text-muted-foreground">· belongs to {taken.name}</span>}</label>; })}</fieldset>
      <p className="text-xs text-muted-foreground">All resources and reported costs in an account belong to its project. Each account can belong to one project. This changes organization in Stratus only.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save project"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div>
    </form>}
    {!editing && error && <p role="alert" className="text-destructive">{error}</p>}
    {!projects.length && <div className="rounded-xl border border-dashed p-8 text-center"><h2 className="font-semibold">Give your cloud a business name</h2><p className="mt-2 text-sm text-muted-foreground">Create projects such as “Company website” or “Testing” to see who owns them and what they cost.</p></div>}
    <div className="grid gap-4 lg:grid-cols-2">{projects.map(p => <article key={p.id} className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold">{p.name}</h2><p className="text-sm">Responsible: {p.owner}</p>{p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
      {canReadResources && <p className="text-sm">{p.resourceCount} resources across {p.accountIds.length} {p.accountIds.length === 1 ? "account" : "accounts"}</p>}
      {canReadCosts && <div><p className="text-xs text-muted-foreground">Reported spending this month · may be incomplete</p>{p.totals.length ? p.totals.map(t => <p key={t.currency} className="text-xl font-semibold">{formatCurrency(t.amount, t.currency)}</p>) : <p className="text-sm">No spending data yet</p>}</div>}
      <ul className="space-y-1 text-sm">{p.accountIds.map(id => <li key={id}><Link className="text-primary underline" href={canReadResources ? `/resources?account=${id}` : `/settings/cloud-accounts/${id}`}>{accounts.find(a => a.id === id)?.displayName ?? "Account"}</Link></li>)}</ul>
      {canManage && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(p); setError(null); }}>Edit {p.name}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(p.id)}>Remove grouping</Button></div>}
      {removing === p.id && <div className="space-y-2 rounded-lg border p-3 text-sm"><p>Remove this project grouping? Its AWS accounts and resources will remain connected and unchanged.</p><div className="flex gap-2"><Button variant="destructive" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/v1/orgs/${orgId}/projects/${p.id}`, { method: "DELETE" }); setRemoving(null); if (current?.id === p.id) setEditing(null); router.refresh(); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>Remove project</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoving(null)}>Keep project</Button></div></div>}
    </article>)}</div>
  </div>;
}
