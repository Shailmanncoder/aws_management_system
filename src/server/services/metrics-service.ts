import "server-only";
import { RESOURCE_TYPES } from "@/lib/resource-types";
import { assertCan, type OrgAccess } from "../authz/guard";
import { cached } from "../cache/tenant-cache";
import { getMetricSeries, type MetricKindName, type MetricSeries, type RangeName } from "../aws/cloudwatch";
import { classifyAwsError } from "../aws/errors";
import { isAppError, notFound } from "../errors";
import { logger } from "../logging/logger";
import { findResource } from "../repositories/resource-repository";
import { enforceRateLimit } from "../security/rate-limit";
import { withAwsSession } from "./aws-session-service";

const KIND_BY_TYPE: Record<string, MetricKindName> = {
  [RESOURCE_TYPES.EC2_INSTANCE]: "ec2",
  [RESOURCE_TYPES.LAMBDA_FUNCTION]: "lambda",
  [RESOURCE_TYPES.RDS_INSTANCE]: "rds",
};

export type MetricsResult =
  | { status: "ok"; range: RangeName; series: MetricSeries[]; fetchedAt: string }
  | { status: "unavailable"; reason: string };

/**
 * On-demand CloudWatch metrics for one resource. Cached per (org, inventoryVersion, resource,
 * range) for 5 minutes; rate-limited per org. Failures return an explicit "unavailable" state
 * with a sanitised reason — never fabricated data.
 */
export async function getResourceMetrics(access: OrgAccess, resourceRefId: string, range: RangeName): Promise<MetricsResult> {
  assertCan(access, "metrics:read");
  const resource = await findResource(access.organizationId, resourceRefId);
  if (!resource) throw notFound("Resource");
  const kind = KIND_BY_TYPE[resource.resourceType];
  if (!kind) return { status: "unavailable", reason: "CloudWatch metrics are not supported for this resource type." };
  const dimension = kind === "lambda" ? (resource.name ?? resource.resourceId) : resource.resourceId;

  return cached(access.organizationId, "metrics", [resourceRefId, range], 5 * 60_000, async () => {
    await enforceRateLimit("metricsQuery", `org:${access.organizationId}`);
    try {
      const series = await withAwsSession(access.organizationId, resource.awsAccount.id, "metrics", ({ session }) =>
        getMetricSeries(session, resource.region, kind, dimension, range),
      );
      return { status: "ok" as const, range, series, fetchedAt: new Date().toISOString() };
    } catch (err) {
      if (isAppError(err) && err.code === "RATE_LIMITED") throw err;
      const cls = isAppError(err) ? err.code : classifyAwsError(err);
      logger.warn("metrics unavailable", { errorClass: cls });
      const reason =
        cls === "access_denied"
          ? "Missing required AWS permission: cloudwatch:GetMetricData"
          : cls === "throttled" || cls === "AWS_THROTTLED"
            ? "AWS API request was throttled. Try again shortly."
            : cls === "AWS_ROLE_UNAVAILABLE"
              ? "AWS role could not be assumed."
              : "CloudWatch data is currently unavailable.";
      return { status: "unavailable" as const, reason };
    }
  });
}
