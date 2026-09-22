import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildHref, type SearchParamsRecord } from "@/lib/url";

export function Pagination({ pathname, params, page, pageSize, total }: { pathname: string; params: SearchParamsRecord; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 px-1 py-2 text-sm text-muted-foreground">
      <span className="tabular">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Button asChild variant="outline" size="icon-sm">
            <Link href={buildHref(pathname, params, { page: page - 1 })} aria-label="Previous page">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" disabled aria-label="Previous page">
            <ChevronLeft aria-hidden />
          </Button>
        )}
        <span className="tabular px-2">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Button asChild variant="outline" size="icon-sm">
            <Link href={buildHref(pathname, params, { page: page + 1 })} aria-label="Next page">
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" disabled aria-label="Next page">
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}
