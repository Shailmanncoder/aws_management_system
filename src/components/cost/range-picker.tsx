"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_PRESETS } from "@/lib/cost-math";

/** Date range: presets or a custom from/to (validated again server-side). */
export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range") ?? "30d";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [open, setOpen] = useState(false);

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={range} onValueChange={(v) => (v === "custom" ? setOpen(true) : go({ range: v, from: null, to: null }))}>
        <SelectTrigger className="h-8 w-44" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(RANGE_PRESETS).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">{range === "custom" && params.get("from") ? `${params.get("from")} → ${params.get("to")}` : "Custom range…"}</SelectItem>
        </SelectContent>
      </Select>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={open ? "" : "sr-only"}>
            Custom range
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to && from <= to) {
                go({ range: "custom", from, to });
                setOpen(false);
              }
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label className="block space-y-1 text-sm">
              <span>To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
            </label>
            <p className="text-xs text-muted-foreground">Up to ~13 months of synced history is available.</p>
            <Button type="submit" size="sm" className="w-full" disabled={!from || !to || from > to}>
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
