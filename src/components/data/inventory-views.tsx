"use client";

import { Bookmark, Link2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { inventoryViewQuery, inventoryViewStorageKey, MAX_INVENTORY_VIEWS, readInventoryViews, type InventoryView } from "@/lib/inventory-views";

const CHANGE_EVENT = "stratus-inventory-views";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}
const serverSnapshot = () => null;

export function InventoryViews({ userId, orgId }: { userId: string; orgId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const storageKey = inventoryViewStorageKey(userId, orgId, pathname);
  return <ViewControls key={storageKey} storageKey={storageKey} pathname={pathname} query={inventoryViewQuery(params.toString())} />;
}

function ViewControls({ storageKey, pathname, query }: { storageKey: string; pathname: string; query: string }) {
  const snapshot = useCallback(() => {
    try { return window.localStorage.getItem(storageKey); } catch { return null; }
  }, [storageKey]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const views = readInventoryViews(raw);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const href = (value: string) => `${pathname}${value ? `?${value}` : ""}`;

  function persist(next: InventoryView[]) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      toast.error("Could not save views. Allow browser storage and try again.");
      return false;
    }
  }

  return (
    <div className="space-y-2" aria-label="Saved inventory views">
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="outline" size="sm" disabled={views.length >= MAX_INVENTORY_VIEWS}><Bookmark aria-hidden /> Save view</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save inventory view</DialogTitle>
              <DialogDescription>Remember the current filters and sort order for this page. Views are saved in this browser for your user and workspace.</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              const current = readInventoryViews(snapshot());
              if (!name.trim()) return;
              if (current.length >= MAX_INVENTORY_VIEWS) { toast.error("Remove a saved view before adding another."); return; }
              if (current.some((view) => view.name.toLowerCase() === name.trim().toLowerCase())) { toast.error("Choose a different name for this view."); return; }
              if (persist([...current, { id: crypto.randomUUID(), name: name.trim(), query }])) {
                setOpen(false);
                setName("");
                toast.success("View saved");
              }
            }}>
              <label className="space-y-1 block text-sm">View name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Production servers" required /></label>
              <Button type="submit" disabled={!name.trim()}>Save view</Button>
            </form>
          </DialogContent>
        </Dialog>
        <Button variant="ghost" size="sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(new URL(href(query), window.location.origin).href);
            toast.success("Link copied. Open it in the same workspace to see this view.");
          } catch { toast.error("Could not copy the link. Copy the address from your browser instead."); }
        }}><Link2 aria-hidden /> Copy view link</Button>
        <span className="text-xs text-muted-foreground">{views.length >= MAX_INVENTORY_VIEWS ? "20 views saved — remove one to add another." : "Saved in this browser"}</span>
      </div>
      {views.length > 0 && <div className="flex flex-wrap gap-2">
        {views.map((view) => <div key={view.id} className="flex items-center rounded-lg border">
          <Button asChild variant={view.query === query ? "secondary" : "ghost"} size="sm">
            <Link href={href(view.query)} scroll={false} aria-current={view.query === query ? "page" : undefined}>{view.name}</Link>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove saved view ${view.name}`} onClick={() => {
            if (persist(readInventoryViews(snapshot()).filter((item) => item.id !== view.id))) toast.success("Saved view removed");
          }}><X aria-hidden /></Button>
        </div>)}
      </div>}
    </div>
  );
}
