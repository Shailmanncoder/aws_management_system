"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TooltipBox } from "./chart-tooltip";
import { axisTick, formatValue, gridProps, type ValueUnit } from "./format";

export interface ColumnDatum {
  x: string;
  y: number | null;
  estimated?: boolean;
}

/**
 * Time columns (single measure). Estimated (not-yet-final) periods use a hatched fill and are
 * named in the tooltip; missing periods render as gaps, never zeros.
 */
export function ColumnChart({ data, unit, label, formatX, formatY }: { data: ColumnDatum[]; unit: ValueUnit; label: string; formatX: (x: string) => string; formatY?: (n: number, compact?: boolean) => string }) {
  const fmt = formatY ?? ((n: number, compact?: boolean) => formatValue(n, unit, compact));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={data.length > 60 ? 1 : 2}>
        <defs>
          <pattern id="estimated-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--chart-1)" opacity="0.35" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-1)" strokeWidth="3" />
          </pattern>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="x" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} minTickGap={24} tickFormatter={formatX} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => fmt(v, true)} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }) => {
            const d = payload?.[0]?.payload as ColumnDatum | undefined;
            if (!active || !d) return null;
            return (
              <TooltipBox
                title={formatX(d.x)}
                rows={[{ label: d.estimated ? `${label} (estimated)` : label, value: d.y === null ? "No data" : fmt(d.y), color: "var(--chart-1)" }]}
              />
            );
          }}
        />
        <Bar dataKey="y" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={48}>
          {data.map((d) => (
            <Cell key={d.x} fill={d.estimated ? "url(#estimated-hatch)" : "var(--chart-1)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
