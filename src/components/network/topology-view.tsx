import { Cloud, Database, Globe, Lock, Network, Router, Scale, Server, Waypoints } from "lucide-react";
import Link from "next/link";
import type { TopoRegion, TopoResource, TopoVpc } from "@/lib/topology";
import { cn } from "@/lib/utils";

function Chip({ r, icon: Icon, href }: { r: TopoResource; icon: typeof Server; href?: string }) {
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="truncate">{r.name ?? r.resourceId}</span>
      {r.state && r.state !== "running" && r.state !== "available" && <span className="text-[10px] text-muted-foreground">({r.state})</span>}
    </>
  );
  const cls = "flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-muted")} title={r.resourceId}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={r.resourceId}>
      {body}
    </span>
  );
}

function VpcBlock({ v }: { v: TopoVpc }) {
  return (
    <section aria-label={`VPC ${v.vpc.name ?? v.vpc.resourceId}`} className="rounded-xl border-2 border-dashed border-chart-1/40 p-3">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Network className="size-4 text-chart-1" aria-hidden />
        <h4 className="font-medium">{v.vpc.name ?? v.vpc.resourceId}</h4>
        <span className="font-mono text-xs text-muted-foreground">
          {v.vpc.resourceId} · {v.cidr}
          {v.isDefault ? " · default VPC" : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {v.internetGateways.length ? (
            v.internetGateways.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                <Globe className="size-3.5" aria-hidden /> Internet gateway {g.resourceId}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> No internet gateway
            </span>
          )}
        </span>
      </header>

      {v.loadBalancers.length > 0 && (
        <div className="mb-3">
          <h5 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Load balancers</h5>
          <ul className="flex flex-wrap gap-1.5">
            {v.loadBalancers.map((l) => (
              <li key={l.resource.id} className="flex items-center gap-1.5">
                <Chip r={l.resource} icon={Scale} />
                <span className="text-[11px] text-muted-foreground">
                  {l.scheme} · subnets {l.subnetIds.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Subnets">
        {v.subnets.map((s) => (
          <li key={s.id} className={cn("rounded-lg border p-2", s.isPublic ? "border-chart-2/50 bg-chart-2/5" : "bg-muted/40")}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{s.name ?? s.resourceId}</span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", s.isPublic ? "bg-chart-2/15" : "bg-muted")} title={s.publicReason}>
                {s.isPublic ? "Public" : "Private"}
              </span>
            </div>
            <p className="mb-2 font-mono text-[11px] text-muted-foreground">
              {s.resourceId} · {s.cidr} · {s.az}
            </p>
            <p className="mb-2 text-[11px] text-muted-foreground">{s.publicReason}</p>
            <ul className="flex flex-wrap gap-1">
              {s.natGateways.map((n) => (
                <li key={n.id}>
                  <Chip r={n} icon={Router} />
                </li>
              ))}
              {s.instances.map((i) => (
                <li key={i.id} className="min-w-0 max-w-full">
                  <Chip r={i} icon={Server} href={`/cloud/ec2/${i.id}`} />
                </li>
              ))}
              {s.instances.length === 0 && s.natGateways.length === 0 && <li className="text-[11px] text-muted-foreground">No instances</li>}
            </ul>
          </li>
        ))}
      </ul>

      {(v.databases.length > 0 || v.endpoints.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {v.databases.length > 0 && (
            <div>
              <h5 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Databases (DB subnet groups)</h5>
              <ul className="space-y-1">
                {v.databases.map((d) => (
                  <li key={d.resource.id} className="flex flex-wrap items-center gap-1.5">
                    <Chip r={d.resource} icon={Database} />
                    <span className="text-[11px] text-muted-foreground">subnets {d.subnetIds.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.endpoints.length > 0 && (
            <div>
              <h5 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">VPC endpoints</h5>
              <ul className="flex flex-wrap gap-1">
                {v.endpoints.map((e) => (
                  <li key={e.id}>
                    <Chip r={e} icon={Waypoints} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {v.unplaced.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{v.unplaced.length} instance(s) reference subnets that are not in the current inventory view.</p>
      )}
    </section>
  );
}

export function TopologyView({ regions, accountNames }: { regions: TopoRegion[]; accountNames: Record<string, string> }) {
  return (
    <div className="space-y-4">
      {regions.map((r) => (
        <section key={`${r.accountRefId}|${r.region}`} aria-label={`${accountNames[r.accountRefId] ?? "Account"} ${r.region}`} className="rounded-xl border bg-card p-3">
          <header className="mb-3 flex items-center gap-2 text-sm">
            <Cloud className="size-4" aria-hidden />
            <span className="font-medium">{accountNames[r.accountRefId] ?? "AWS account"}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono text-xs">{r.region}</span>
          </header>
          <div className="space-y-3">
            {r.vpcs.map((v) => (
              <VpcBlock key={v.vpc.id} v={v} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
