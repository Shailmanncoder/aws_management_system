import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { HelpForm, HelpStatus } from "@/components/simple/help";
import { Explain } from "@/components/simple/explain";
import { getPageAccess } from "@/server/services/workspace-context";
import { getHelp, getHelpTarget, getPriorities, helpMembers } from "@/server/services/simple-service";
import { HELP_KINDS, HELP_PERMISSION, helpHref, type HelpKind } from "@/lib/simple";
import { isUuid } from "@/server/validation/common";
import { formatDateTime } from "@/lib/format";
import { DiagnosticAssistant } from "@/components/help/diagnostic-assistant";
import { getDiagnosticAssistant } from "@/server/services/diagnostic-assistant-service";
export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const { access } = await getPageAccess("org:read"); if (!access) return null;
  const raw = await searchParams;
  const [requests, priorities, members, diagnosticAssistant] = await Promise.all([
    getHelp(access), getPriorities(access), helpMembers(access), getDiagnosticAssistant(access),
  ]);
  const issues = priorities.actions.map(a => ({ id: a.id, kind: a.kind, title: a.title }));
  const kind = typeof raw.kind === "string" && HELP_KINDS.includes(raw.kind as HelpKind) ? raw.kind as HelpKind : null;
  const target = kind && isUuid(raw.target) && access.can(HELP_PERMISSION[kind]) ? await getHelpTarget(access, kind, raw.target) : null;
  if (target && !issues.some(a => a.id === target.id && a.kind === target.kind)) issues.unshift(target);
  return <div className="mx-auto max-w-5xl space-y-6"><PageHeader title="Team help" description="Assign an issue with its context attached, then track it here. Requests cover the whole workspace." />
    <DiagnosticAssistant orgId={access.organizationId} initial={diagnosticAssistant} />
    <HelpForm orgId={access.organizationId} issues={issues} members={members.map(m => ({ userId: m.userId, role: m.role, name: m.user.name }))} selected={target ? `${target.kind}:${target.id}` : undefined} />
    <section className="space-y-3"><h2 className="text-xl font-semibold">Team requests</h2>{!requests.length && <p className="text-sm text-muted-foreground">No help requests yet.</p>}{requests.map(r => <article key={r.id} className="space-y-3 rounded-xl border bg-card p-5"><div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold text-primary underline" href={helpHref(r.kind, r.targetId)}>{r.title}</Link><span className="text-sm">{r.status === "DONE" ? "Completed" : "Open"}</span></div><p className="text-sm">Assigned to {r.assignee?.name ?? "a removed team member"}</p>{r.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}<p className="text-xs text-muted-foreground">Requested {formatDateTime(r.createdAt)}</p>{(r.assigneeId === access.userId || r.requestedById === access.userId || access.can("org:update")) && <HelpStatus orgId={access.organizationId} id={r.id} status={r.status} />}</article>)}<p className="text-xs text-muted-foreground">Showing up to 100 recent requests you have permission to view.</p></section>
    <Explain><p>Completing a request records that your teammate has finished helping. It does not close the underlying security finding or change AWS resources. Findings clear when a subsequent check confirms the issue is resolved.</p></Explain>
  </div>;
}
