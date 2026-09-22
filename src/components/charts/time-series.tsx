"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TooltipBox } from "./chart-tooltip";
import { axisTick, formatValue, gridProps, shortTime, type ValueUnit } from "./format";

/** Single-series time series (one measure per chart — never dual axes). */
export function TimeSeries({ data, unit, color = "var(--chart-1)", label }: { data: { t: string; v: number }[]; unit: ValueUnit; color?: string; label: string }) {
  const span = data.length > 1 ? new Date(data[data.length - 1]!.t).getTime() - new Date(data[0]!.t).getTime() : 0;
  const gradientId = `g-${label.replace(/\W/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} minTickGap={40} tickFormatter={(t: string) => shortTime(t, span)} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatValue(v, unit, true)} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox title={new Date(String(payload[0].payload.t)).toLocaleString()} rows={[{ label, value: formatValue(Number(payload[0].value), unit), color }]} />
            ) : null
          }
        />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
