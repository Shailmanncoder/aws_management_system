"use client";

import { SIMPLE_LABELS } from "@/lib/simple";
import { useSimpleMode } from "@/components/simple/mode";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { api } from "@/lib/api-client";
import { hasPermission, type Role } from "@/lib/rbac";
import { NAV_SECTIONS } from "./nav-items";

interface Result {
  id: string;
  type: string;
  name: string;
  resourceId: string;
  region: string;
  account: string;
  href: string;
}

/** ⌘K / Ctrl+K: jump to any page or search resources by name, ID, ARN, IP, tag, region or account. */
export function CommandPalette({ orgId, role }: { orgId: string; role: Role }) {
  const simple = useSimpleMode();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; items: Result[] } | null>(null);
  const canSearch = hasPermission(role, "inventory:read");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!canSearch || term.length < 2) return;
    const t = setTimeout(() => {
      api<{ results: Result[] }>(`/api/v1/orgs/${orgId}/search?q=${encodeURIComponent(term.slice(0, 128))}`)
        .then((r) => setResults({ q: term, items: r.results }))
        .catch(() => setResults({ q: term, items: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, orgId, canSearch]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const items = results && results.q === q.trim() ? results.items : [];
  const pages = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => hasPermission(role, i.permission));

  return (
    <>
      <Button variant="outline" size="sm" className="hidden w-56 justify-start gap-2 text-muted-foreground lg:inline-flex" onClick={() => setOpen(true)} aria-label="Search resources and pages">
        <Search aria-hidden /> Search…
        <kbd className="ml-auto rounded border bg-muted px-1.5 text-[10px]">⌘K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Search">
        <Search aria-hidden />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search pages and AWS resources">
        <Command shouldFilter={false}>
        <CommandInput placeholder="Name, instance ID, ARN, IP, tag, region…" value={q} onValueChange={setQ} maxLength={128} />
        <CommandList>
          <CommandEmpty>{q.trim().length < 2 ? "Type at least 2 characters." : "No matches."}</CommandEmpty>
          {items.length > 0 && (
            <CommandGroup heading="Resources">
              {items.map((r) => (
                <CommandItem key={r.id} value={r.id} onSelect={() => go(r.href)}>
                  <div className="min-w-0">
                    <div className="truncate">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.type} · {r.resourceId} · {r.region} · {r.account}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Pages">
            {pages
              .filter((p) => !q.trim() || `${p.label} ${SIMPLE_LABELS[p.href] ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
              .map((p) => {
                const Icon = p.icon;
                return (
                  <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)}>
                    <Icon className="size-4" aria-hidden /> {simple ? SIMPLE_LABELS[p.href] ?? p.label : p.label}
                  </CommandItem>
                );
              })}
          </CommandGroup>
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
