import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { TableHead } from "@/components/ui/table";
import { buildHref, firstParam, type SearchParamsRecord } from "@/lib/url";

export function SortHeader({ label, field, pathname, params, className }: { label: string; field: string; pathname: string; params: SearchParamsRecord; className?: string }) {
  const active = firstParam(params.sort) === field;
  const dir = active && firstParam(params.dir) === "desc" ? "desc" : "asc";
  const next = active && dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead scope="col" className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={buildHref(pathname, params, { sort: field, dir: next, page: null })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icon className="size-3.5 opacity-60" aria-hidden />
      </Link>
    </TableHead>
  );
}
