import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { buildExport, REPORTS } from "@/server/services/export-service";
import "@/server/services/report-registrations";

const QUERY_KEYS = ["q", "account", "region", "state", "type", "tag", "vpc", "instanceType", "sort", "dir", "range", "from", "to", "severity", "status", "category", "groupBy"] as const;
// Unknown keys are rejected; values are re-validated by each report's own parser.
const query = z.strictObject(Object.fromEntries(QUERY_KEYS.map((k) => [k, z.string().max(256).optional()])));

export const GET = orgRoute(
  {
    operation: "reports.export",
    permission: "reports:export",
    params: z.strictObject({ report: z.enum(REPORTS) }),
    query,
    rateLimit: "export",
  },
  async ({ access, params, query: q, requestId }) => {
    const clean = Object.fromEntries(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string"));
    const stream = await buildExport(access, params.report, clean);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="stratus-${params.report}-${stamp}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  },
);
