import "server-only";
import { CostExplorerClient, GetCostAndUsageCommand, type ResultByTime } from "@aws-sdk/client-cost-explorer";
import { createAwsClient } from "./client-factory";
import { paginate } from "./paginate";
import { globalRegionFor } from "./regions-catalog";
import type { AwsSession } from "./session";

export type CeDimension = "TOTAL" | "SERVICE" | "REGION" | "LINKED_ACCOUNT";

export interface CostRow {
  periodStart: string; // YYYY-MM-DD
  dimension: CeDimension;
  key: string;
  amount: number;
  unit: string;
  estimated: boolean;
}

/**
 * Fetches UnblendedCost from Cost Explorer. NOTE: AWS bills every GetCostAndUsage request
 * (≈ $0.01 each), so callers batch by dimension and the sync only re-fetches recent windows.
 */
export async function fetchCosts(
  session: AwsSession,
  opts: { start: string; end: string; granularity: "DAILY" | "MONTHLY"; dimension: CeDimension },
): Promise<{ rows: CostRow[]; requests: number }> {
  const ce = createAwsClient(CostExplorerClient, session, globalRegionFor(session.partition), "ce");
  let requests = 0;
  try {
    const results = await paginate(
      (NextPageToken) => {
        requests++;
        return ce.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: opts.start, End: opts.end },
            Granularity: opts.granularity,
            Metrics: ["UnblendedCost"],
            Filter: { Dimensions: { Key: "LINKED_ACCOUNT", Values: [session.accountId] } },
            GroupBy: opts.dimension === "TOTAL" ? undefined : [{ Type: "DIMENSION", Key: opts.dimension }],
            NextPageToken,
          }),
        );
      },
      (p) => ({ items: p.ResultsByTime, nextToken: p.NextPageToken }),
      { maxPages: 50 },
    );
    return { rows: results.flatMap((r) => toRows(r, opts.dimension)), requests };
  } finally {
    ce.destroy();
  }
}

function toRows(r: ResultByTime, dimension: CeDimension): CostRow[] {
  const periodStart = r.TimePeriod?.Start;
  if (!periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return [];
  const estimated = Boolean(r.Estimated);
  if (dimension === "TOTAL") {
    const m = r.Total?.UnblendedCost;
    const amount = Number(m?.Amount);
    if (!m?.Unit || !/^[A-Z]{3}$/.test(m.Unit)) throw new Error("Missing or invalid cost currency");
    return Number.isFinite(amount) ? [{ periodStart, dimension, key: "", amount, unit: m.Unit, estimated }] : [];
  }
  return (r.Groups ?? []).flatMap((g) => {
    const m = g.Metrics?.UnblendedCost;
    const amount = Number(m?.Amount);
    if (!m?.Unit || !/^[A-Z]{3}$/.test(m.Unit)) throw new Error("Missing or invalid cost currency");
    const key = (g.Keys?.[0] ?? "").slice(0, 200) || "(none)";
    return Number.isFinite(amount) ? [{ periodStart, dimension, key: key === "NoRegion" ? "global" : key, amount, unit: m.Unit, estimated }] : [];
  });
}
