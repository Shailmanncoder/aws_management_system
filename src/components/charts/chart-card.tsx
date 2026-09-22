"use client";

import { AlertTriangle, BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ChartState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "empty"; message: string } | { kind: "ready" };

/**
 * Standard chart container: title, description, loading/empty/error states, a screen-reader
 * summary and a toggle to an accessible data table (never colour-only information).
 */
export function ChartCard({
  title,
  description,
  state,
  summary,
  table,
  actions,
  className,
  height = 220,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  state: ChartState;
  /** Plain-language summary read by assistive tech, e.g. "Average 38%, peak 61%". */
  summary?: string;
  table?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  height?: number;
  children?: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && state.kind === "ready" && (
            <Button variant="ghost" size="icon-sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable} aria-label={showTable ? `Show ${title} as chart` : `Show ${title} as table`}>
              {showTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {state.kind === "loading" && <Skeleton className="w-full" style={{ height }} aria-label={`Loading ${title}`} />}
        {state.kind === "error" && (
          <div role="alert" className="flex items-center justify-center gap-2 rounded-md border border-dashed text-center text-sm text-muted-foreground" style={{ height }}>
            <AlertTriangle className="size-4 text-status-serious" aria-hidden />
            <span className="max-w-xs">{state.message}</span>
          </div>
        )}
        {state.kind === "empty" && (
          <div className="flex items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground" style={{ height }}>
            {state.message}
          </div>
        )}
        {state.kind === "ready" &&
          (showTable ? (
            <div className="overflow-auto" style={{ maxHeight: height }}>
              {table}
            </div>
          ) : (
            <figure role="img" aria-label={summary ? `${title}. ${summary}` : title} style={{ height }} className="w-full">
              {children}
            </figure>
          ))}
        {state.kind === "ready" && summary && <p className="sr-only">{summary}</p>}
      </CardContent>
    </Card>
  );
}
