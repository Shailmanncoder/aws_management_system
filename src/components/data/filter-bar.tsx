"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FacetDef {
  param: string;
  label: string;
  options: { value: string; label: string }[];
}

const ALL = "__all__";

/**
 * URL-driven filters: every change updates the query string (shareable, back-button friendly)
 * and the server re-renders with validated params. Global scope params (account/region) are
 * preserved.
 */
export function FilterBar({ facets = [], searchPlaceholder = "Search name, ID, IP, tag…", tagFilter = true }: { facets?: FacetDef[]; searchPlaceholder?: string; tagFilter?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [tag, setTag] = useState(params.get("tag") ?? "");

  const urlQ = params.get("q") ?? "";
  const urlTag = params.get("tag") ?? "";
  const [previousUrl, setPreviousUrl] = useState({ q: urlQ, tag: urlTag });
  // Navigation (including saved views and Back) must update the visible inputs.
  if (previousUrl.q !== urlQ || previousUrl.tag !== urlTag) {
    setPreviousUrl({ q: urlQ, tag: urlTag });
    setQ(urlQ);
    setTag(urlTag);
  }

  const update = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false }));
  }, [params, pathname, router]);

  useEffect(() => {
    const t = setTimeout(() => {
      const search = q.trim().slice(0, 128);
      if ((params.get("q") ?? "") !== search) update({ q: search || null });
    }, 350);
    return () => clearTimeout(t);
  }, [q, params, update]);

  const hasFilters = facets.some((f) => params.get(f.param)) || params.get("q") || params.get("tag");

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-busy={pending}>
      <div className="relative min-w-52 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search" maxLength={128} />
      </div>
      {facets.map((f) => (
        <Select key={f.param} value={params.get(f.param) ?? ALL} onValueChange={(v) => update({ [f.param]: v === ALL ? null : v })}>
          <SelectTrigger className="h-8 w-auto min-w-36" aria-label={f.label}>
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {f.label.toLowerCase()}</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {tagFilter && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ tag: tag.trim() || null });
          }}
        >
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag key=value" className="h-8 w-40" aria-label="Filter by tag (key or key=value)" maxLength={257} />
        </form>
      )}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            setTag("");
            update(Object.fromEntries([...facets.map((f) => [f.param, null]), ["q", null], ["tag", null]]));
          }}
        >
          <X aria-hidden /> Clear
        </Button>
      )}
    </div>
  );
}
