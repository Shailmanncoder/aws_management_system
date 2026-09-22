import "server-only";
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { createAwsClient } from "./client-factory";
import { paginate } from "./paginate";
import type { AwsSession } from "./session";

export type MetricUnit = "percent" | "bytes" | "count" | "ms";

export interface MetricDef {
  name: string;
  stat: "Average" | "Sum" | "Maximum";
  unit: MetricUnit;
  label: string;
}

export interface MetricKind {
  namespace: string;
  dimension: string;
  metrics: MetricDef[];
}

export const METRIC_KINDS = {
  ec2: {
    namespace: "AWS/EC2",
    dimension: "InstanceId",
    metrics: [
      { name: "CPUUtilization", stat: "Average", unit: "percent", label: "CPU utilization" },
      { name: "NetworkIn", stat: "Sum", unit: "bytes", label: "Network in" },
      { name: "NetworkOut", stat: "Sum", unit: "bytes", label: "Network out" },
      { name: "DiskReadBytes", stat: "Sum", unit: "bytes", label: "Disk read" },
      { name: "DiskWriteBytes", stat: "Sum", unit: "bytes", label: "Disk write" },
      { name: "StatusCheckFailed", stat: "Maximum", unit: "count", label: "Status check failed" },
    ],
  },
  lambda: {
    namespace: "AWS/Lambda",
    dimension: "FunctionName",
    metrics: [
      { name: "Invocations", stat: "Sum", unit: "count", label: "Invocations" },
      { name: "Errors", stat: "Sum", unit: "count", label: "Errors" },
      { name: "Duration", stat: "Average", unit: "ms", label: "Duration (avg)" },
      { name: "Throttles", stat: "Sum", unit: "count", label: "Throttles" },
    ],
  },
  rds: {
    namespace: "AWS/RDS",
    dimension: "DBInstanceIdentifier",
    metrics: [
      { name: "CPUUtilization", stat: "Average", unit: "percent", label: "CPU utilization" },
      { name: "DatabaseConnections", stat: "Average", unit: "count", label: "Connections" },
      { name: "FreeStorageSpace", stat: "Average", unit: "bytes", label: "Free storage" },
    ],
  },
} as const satisfies Record<string, MetricKind>;

export type MetricKindName = keyof typeof METRIC_KINDS;

export const RANGES = {
  "1h": { ms: 3600_000, period: 60 },
  "24h": { ms: 86_400_000, period: 300 },
  "7d": { ms: 7 * 86_400_000, period: 1800 },
  "30d": { ms: 30 * 86_400_000, period: 14_400 },
} as const;
export type RangeName = keyof typeof RANGES;

export interface MetricSeries {
  name: string;
  label: string;
  unit: MetricUnit;
  stat: string;
  points: { t: string; v: number }[];
}

/** Fetches all metrics of a kind for one resource in a single paginated GetMetricData call. */
export async function getMetricSeries(session: AwsSession, region: string, kind: MetricKindName, dimensionValue: string, range: RangeName): Promise<MetricSeries[]> {
  const def: MetricKind = METRIC_KINDS[kind];
  const r = RANGES[range];
  const end = new Date();
  const start = new Date(end.getTime() - r.ms);
  const queries: MetricDataQuery[] = def.metrics.map((m, i) => ({
    Id: `m${i}`,
    MetricStat: {
      Metric: { Namespace: def.namespace, MetricName: m.name, Dimensions: [{ Name: def.dimension, Value: dimensionValue }] },
      Period: r.period,
      Stat: m.stat,
    },
    ReturnData: true,
  }));
  const cw = createAwsClient(CloudWatchClient, session, region, "cloudwatch");
  try {
    const results = await paginate(
      (NextToken) => cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end, NextToken, ScanBy: "TimestampAscending" })),
      (p) => ({ items: p.MetricDataResults, nextToken: p.NextToken }),
      { maxPages: 20 },
    );
    return def.metrics.map((m, i) => {
      const parts = results.filter((x) => x.Id === `m${i}`);
      const points = parts.flatMap((p) => (p.Timestamps ?? []).map((t, j) => ({ t: new Date(t).toISOString(), v: Number(p.Values?.[j] ?? 0) })));
      points.sort((a, b) => a.t.localeCompare(b.t));
      return { name: m.name, label: m.label, unit: m.unit, stat: m.stat, points };
    });
  } finally {
    cw.destroy();
  }
}

export interface CpuSummary {
  instanceId: string;
  avg: number | null;
  max: number | null;
  datapoints: number;
}

/**
 * 14-day daily CPU average + maximum for many instances in one region. Batched (2 queries per
 * instance, ≤500 queries per GetMetricData call) and fully paginated.
 */
export async function collectCpuSummaries(session: AwsSession, region: string, instanceIds: string[], days = 14): Promise<CpuSummary[]> {
  if (instanceIds.length === 0) return [];
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const cw = createAwsClient(CloudWatchClient, session, region, "cloudwatch");
  const out: CpuSummary[] = [];
  try {
    for (let i = 0; i < instanceIds.length; i += 250) {
      const batch = instanceIds.slice(i, i + 250);
      const queries: MetricDataQuery[] = batch.flatMap((id, j) =>
        (["Average", "Maximum"] as const).map((Stat) => ({
          Id: `${Stat === "Average" ? "a" : "x"}${j}`,
          MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUUtilization", Dimensions: [{ Name: "InstanceId", Value: id }] }, Period: 86_400, Stat },
          ReturnData: true,
        })),
      );
      const results = await paginate(
        (NextToken) => cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end, NextToken })),
        (p) => ({ items: p.MetricDataResults, nextToken: p.NextToken }),
        { maxPages: 50 },
      );
      batch.forEach((id, j) => {
        const avgVals = results.filter((r) => r.Id === `a${j}`).flatMap((r) => r.Values ?? []);
        const maxVals = results.filter((r) => r.Id === `x${j}`).flatMap((r) => r.Values ?? []);
        out.push({
          instanceId: id,
          avg: avgVals.length ? avgVals.reduce((s, v) => s + v, 0) / avgVals.length : null,
          max: maxVals.length ? Math.max(...maxVals) : null,
          datapoints: avgVals.length,
        });
      });
    }
    return out;
  } finally {
    cw.destroy();
  }
}
