import Link from "next/link";
import type { OrgAccess } from "@/server/authz/guard";
import { listRecords } from "@/server/services/operations-service";
import { inventoryViewQuery } from "@/lib/inventory-views";
import { Button } from "@/components/ui/button";

export async function SharedInventoryViews({ access, path }: { access: OrgAccess; path: string }) {
  const views = (await listRecords(access, "VIEW")).filter(r => (r.payload as { path?: string }).path === path);
  return <div className="flex flex-wrap items-center gap-2" aria-label="Workspace saved views">
    {views.map(view => { const query = inventoryViewQuery(String((view.payload as { query?: string }).query ?? "")); return <Button key={view.id} variant="outline" size="sm" asChild><Link href={`${path}${query ? `?${query}` : ""}`}>{view.name} · {view.shared ? "Shared" : "Personal"}</Link></Button>; })}
    <Link className="text-xs text-muted-foreground underline" href="/operations?tab=Team">Manage workspace views</Link>
  </div>;
}
