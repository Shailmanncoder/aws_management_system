import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { EbsVolumeAttrs, Ec2InstanceAttrs } from "@/lib/resource-types";
import { collectCpuSummaries } from "../aws/cloudwatch";
import { mapSettledLimit } from "../aws/concurrency";
import { loadPriceBook } from "../aws/pricing";
import { getDb } from "../db";
import { LeaseLostError } from "../jobs/lease";
import { logger } from "../logging/logger";
import { evaluateOptimization, type CpuStats, type OptimizationDraft } from "../rules/optimization-rules";
import type { PostSyncContext } from "./post-sync";
import { findingFingerprint } from "./security-sync";

/**
 * Post-sync optimisation analysis:
 *  1. 14-day CPU utilisation for running instances (stored as MetricSummary)
 *  2. public list prices for the resources involved (Price List API)
 *  3. pure rule evaluation → upsert findings; findings not re-detected are resolved
 *     (dismissed findings stay dismissed).
 */
export async function runOptimizationAnalysis(ctx: PostSyncContext): Promise<void> {
  const db = getDb();
  const scope = { organizationId: ctx.organizationId, awsAccountRefId: ctx.accountRefId };
  const [org, rows] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { requiredTagKeys: true } }),
    db.awsResource.findMany({
      where: { ...scope, deletedAt: null, resourceType: { in: ["ec2:instance", "ec2:volume", "ec2:snapshot", "ec2:elastic-ip", "s3:bucket", "rds:db-instance", "lambda:function", "dynamodb:table", "elb:load-balancer"] } },
      select: { id: true, resourceType: true, region: true, resourceId: true, name: true, state: true, attributes: true, tags: { select: { key: true, value: true } } },
      take: 20_000,
    }),
  ]);
  const resources = rows.map((r) => ({ ...r, tags: Object.fromEntries(r.tags.map((t) => [t.key, t.value])) }));

  // 1. CPU utilisation (per region, bounded concurrency). Failures leave cpu unknown → no rightsizing claims.
  const running = resources.filter((r) => r.resourceType === "ec2:instance" && r.state === "running");
  const byRegion = new Map<string, string[]>();
  for (const r of running) byRegion.set(r.region, [...(byRegion.get(r.region) ?? []), r.resourceId]);
  const cpu = new Map<string, CpuStats>();
  const cpuResults = await mapSettledLimit([...byRegion.entries()], 3, ([region, ids]) => collectCpuSummaries(ctx.session, region, ids));
  for (const res of cpuResults) {
    if (res.status === "fulfilled") for (const s of res.value) cpu.set(s.instanceId, s);
    else logger.warn("cpu metrics unavailable for a region", { err: res.reason });
  }
  if (!(await ctx.heartbeat())) throw new LeaseLostError();

  // 2. Prices for exactly what the rules may need.
  const vols = resources.filter((r) => r.resourceType === "ec2:volume");
  const prices = await loadPriceBook(ctx.session, {
    ebs: [...new Set(vols.flatMap((v) => { const t = (v.attributes as unknown as EbsVolumeAttrs).volumeType; return t ? [`${v.region}|${t}`, `${v.region}|gp3`] : []; }))].map((k) => k.split("|") as [string, string]),
    snapshots: [...new Set(resources.filter((r) => r.resourceType === "ec2:snapshot").map((r) => r.region))],
    instances: [...new Set(running.map((r) => `${r.region}|${(r.attributes as unknown as Ec2InstanceAttrs).instanceType}`))].map((k) => k.split("|") as [string, string]),
    ipv4: [...new Set(resources.filter((r) => r.resourceType === "ec2:elastic-ip").map((r) => r.region))],
  }).catch((err: unknown) => {
    logger.warn("price list unavailable", { err });
    return null;
  });
  if (!(await ctx.heartbeat())) throw new LeaseLostError();

  const drafts = evaluateOptimization({
    resources,
    cpu,
    prices: prices ?? { available: false, ebsGbMonth: () => null, snapshotGbMonth: () => null, instanceHourly: () => null, publicIpv4Hourly: () => null },
    requiredTagKeys: org?.requiredTagKeys ?? [],
    now: new Date(),
  });
  const now = new Date();

  await db.$transaction(
    async (tx) => {
      await ctx.fence?.(tx);
      // Persist CPU summaries for display / explainability.
      const byResourceId = new Map(running.map((r) => [r.resourceId, r.id]));
      for (const [instanceId, s] of cpu) {
        const resourceRefId = byResourceId.get(instanceId);
        if (!resourceRefId) continue;
        for (const [statistic, value] of [["Average", s.avg], ["Maximum", s.max]] as const) {
          await tx.metricSummary.upsert({
            where: { resourceRefId_metricName_statistic_periodDays: { resourceRefId, metricName: "CPUUtilization", statistic, periodDays: 14 } },
            create: { organizationId: ctx.organizationId, resourceRefId, metricName: "CPUUtilization", statistic, periodDays: 14, value, datapoints: s.datapoints, collectedAt: now },
            update: { value, datapoints: s.datapoints, collectedAt: now },
          });
        }
      }
      const seen: string[] = [];
      for (const d of drafts) seen.push(await persist(tx, ctx, d, now));
      await tx.optimizationFinding.updateMany({
        where: { ...scope, status: "OPEN", fingerprint: { notIn: seen } },
        data: { status: "RESOLVED", resolvedAt: now },
      });
    },
    { timeout: 60_000 },
  );
}

async function persist(tx: Prisma.TransactionClient, ctx: PostSyncContext, d: OptimizationDraft, now: Date): Promise<string> {
  const fingerprint = findingFingerprint(ctx.accountRefId, "OPTIMIZATION", d.ruleId, d.subjectKey);
  const { subjectKey: _s, estimatedMonthlySavings, ...values } = d;
  void _s;
  const data = {
    ...values,
    evidence: values.evidence as Prisma.InputJsonValue,
    estimatedMonthlySavings: estimatedMonthlySavings === null ? null : new Prisma.Decimal(estimatedMonthlySavings.toFixed(2)),
    savingsCurrency: estimatedMonthlySavings === null ? null : "USD",
    lastSeenAt: now,
  };
  const key = { organizationId: ctx.organizationId, fingerprint };
  await tx.optimizationFinding.upsert({
    where: { organizationId_fingerprint: key },
    create: { organizationId: ctx.organizationId, awsAccountRefId: ctx.accountRefId, ...data, fingerprint },
    update: data,
  });
  await tx.optimizationFinding.updateMany({ where: { ...key, status: "RESOLVED" }, data: { status: "OPEN", resolvedAt: null } });
  return fingerprint;
}
