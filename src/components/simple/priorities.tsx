import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PriorityAction } from "@/lib/simple";
import { formatDateTime } from "@/lib/format";
import { Explain } from "./explain";
export function Priorities({ actions }: { actions: PriorityAction[] }) {
  return <section className="space-y-3"><div><h2 className="text-xl font-semibold">What needs your attention</h2><p className="text-sm text-muted-foreground">Urgent issues first, followed by connection checks and savings opportunities.</p></div>
    {!actions.length && <div className="rounded-xl border bg-card p-5"><p>No actions found in the information you can access.</p><p className="mt-1 text-sm text-muted-foreground">Missing or incomplete checks can hide issues. Review scan coverage before treating this as an all-clear.</p></div>}
    <div className="grid gap-3 lg:grid-cols-2">{actions.map(a => <article key={`${a.kind}:${a.id}`} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <span className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${a.priority === "Urgent" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{a.priority}</span>
      <h3 className="font-semibold">{a.title}</h3><p className="text-sm text-muted-foreground">{a.next}</p>
      <Explain><p>{a.reason}</p><p>Last observed: {a.checkedAt ? formatDateTime(a.checkedAt) : "Not checked yet"}. Review the latest evidence before acting.</p></Explain>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm"><Link className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={a.href}>Review next step <ArrowRight className="size-4" /></Link><Link className="text-muted-foreground underline" href={`/help?kind=${a.kind}&target=${a.id}`}>Ask a teammate</Link></div>
    </article>)}</div>
  </section>;
}
