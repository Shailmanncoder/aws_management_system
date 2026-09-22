import { z } from "zod";
import { RANGES } from "@/server/aws/cloudwatch";
import { orgRoute } from "@/server/http/route";
import { getResourceMetrics } from "@/server/services/metrics-service";
import { uuidSchema } from "@/server/validation/common";

export const GET = orgRoute(
  {
    operation: "metrics.get",
    permission: "metrics:read",
    params: z.strictObject({ id: uuidSchema }),
    query: z.strictObject({ range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES, ...(keyof typeof RANGES)[]]).default("24h") }),
  },
  async ({ access, params, query }) => getResourceMetrics(access, params.id, query.range),
);
