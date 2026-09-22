/**
 * Optimisation rule engine (pure). Every recommendation states the resource, reason, evidence,
 * potential impact, recommended action, and its confidence / data limitations, and is labelled:
 *   CONFIRMED  — fact taken directly from AWS configuration
 *   HEURISTIC  — rule of thumb from observed signals; requires human validation
 *   ESTIMATED  — includes a savings figure computed from public list prices + observed usage
 * A savings amount is only produced when a real price was retrieved; otherwise it is null.
 */
import type { EbsSnapshotAttrs, EbsVolumeAttrs, Ec2InstanceAttrs, ElasticIpAttrs, S3BucketAttrs } from "@/lib/resource-types";
import type { PriceBook } from "../aws/pricing";
import type { RuleResource } from "./security-rules";

export type DataBasis = "CONFIRMED" | "HEURISTIC" | "ESTIMATED";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface OptimizationDraft {
  ruleId: string;
  subjectKey: string;
  resourceRefId: string | null;
  category: "idle" | "storage" | "rightsizing" | "network" | "governance";
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  impact: string;
  recommendation: string;
  limitations: string;
  dataBasis: DataBasis;
  confidence: Confidence;
  estimatedMonthlySavings: number | null;
  region: string;
}

export interface CpuStats {
  avg: number | null;
  max: number | null;
  datapoints: number;
}

export interface OptimizationInput {
  resources: (RuleResource & { tags?: Record<string, string>; state?: string | null })[];
  cpu: Map<string, CpuStats>; // key: instance resourceId
  prices: PriceBook;
  requiredTagKeys: string[];
  now: Date;
}

const HOURS_PER_MONTH = 730;
const DAY = 86_400_000;
const PRICE_NOTE = "Savings use AWS public on-demand list prices (Price List API) and exclude Savings Plans, Reserved Instances, negotiated discounts, free tier and tax.";
const money = (n: number) => Math.round(n * 100) / 100;

const base = (r: RuleResource, partial: Omit<OptimizationDraft, "subjectKey" | "resourceRefId" | "region">): OptimizationDraft => ({
  ...partial,
  subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|${partial.ruleId}`,
  resourceRefId: r.id,
  region: r.region,
});

const label = (r: RuleResource) => (r.name && r.name !== r.resourceId ? `${r.name} (${r.resourceId})` : r.resourceId);

export function evaluateOptimization(input: OptimizationInput): OptimizationDraft[] {
  const out: OptimizationDraft[] = [];
  const { prices, now } = input;
  const volumes = new Map(input.resources.filter((r) => r.resourceType === "ec2:volume").map((v) => [v.resourceId, v]));

  for (const r of input.resources) {
    switch (r.resourceType) {
      case "ec2:volume": {
        const a = r.attributes as EbsVolumeAttrs;
        const price = a.volumeType ? prices.ebsGbMonth(r.region, a.volumeType) : null;
        if (a.attachedInstanceIds.length === 0 && r.state === "available") {
          const ageDays = a.createTime ? Math.floor((now.getTime() - new Date(a.createTime).getTime()) / DAY) : null;
          out.push(
            base(r, {
              ruleId: "EBS-UNATTACHED",
              category: "idle",
              title: `Unattached EBS volume ${label(r)} (${a.sizeGiB} GiB ${a.volumeType ?? ""})`,
              reason: "The volume is in the 'available' state and not attached to any instance, but storage is still billed.",
              evidence: { state: r.state, sizeGiB: a.sizeGiB, volumeType: a.volumeType, ageDays, pricePerGbMonthUsd: price },
              impact: price !== null ? `About $${money(a.sizeGiB * price)}/month of storage charges.` : "Ongoing storage charges for the provisioned size.",
              recommendation: "Confirm the data is not needed (or snapshot it), then delete the volume.",
              limitations: `The volume may be intentionally detached (e.g. a standby or forensic copy). ${price !== null ? PRICE_NOTE : "No list price was available, so no savings figure is shown."}`,
              dataBasis: price !== null ? "ESTIMATED" : "CONFIRMED",
              confidence: "HIGH",
              estimatedMonthlySavings: price !== null ? money(a.sizeGiB * price) : null,
            }),
          );
        }
        if (a.volumeType === "gp2") {
          const gp3 = prices.ebsGbMonth(r.region, "gp3");
          const delta = price !== null && gp3 !== null ? (price - gp3) * a.sizeGiB : null;
          out.push(
            base(r, {
              ruleId: "EBS-GP2-TO-GP3",
              category: "storage",
              title: `Migrate ${label(r)} from gp2 to gp3`,
              reason: "gp3 volumes cost less per GiB than gp2 and include a 3,000 IOPS / 125 MiB/s baseline independent of size.",
              evidence: { volumeType: "gp2", sizeGiB: a.sizeGiB, gp2PerGbMonthUsd: price, gp3PerGbMonthUsd: gp3 },
              impact: delta !== null && delta > 0 ? `About $${money(delta)}/month lower storage cost.` : "Lower storage cost per GiB.",
              recommendation: "Modify the volume type to gp3 (online, no downtime). Check the workload's IOPS/throughput needs first.",
              limitations: `Large gp2 volumes (>1 TiB) get more baseline IOPS than gp3's default; provisioning extra gp3 IOPS would reduce savings. ${delta !== null ? PRICE_NOTE : "No list price was available, so no savings figure is shown."}`,
              dataBasis: delta !== null && delta > 0 ? "ESTIMATED" : "CONFIRMED",
              confidence: a.sizeGiB > 1000 ? "LOW" : "MEDIUM",
              estimatedMonthlySavings: delta !== null && delta > 0 ? money(delta) : null,
            }),
          );
        }
        break;
      }
      case "ec2:snapshot": {
        const a = r.attributes as EbsSnapshotAttrs;
        const ageDays = a.startTime ? Math.floor((now.getTime() - new Date(a.startTime).getTime()) / DAY) : null;
        if (ageDays === null || ageDays < 365) break;
        const price = prices.snapshotGbMonth(r.region);
        out.push(
          base(r, {
            ruleId: "SNAPSHOT-OLD",
            category: "storage",
            title: `Snapshot ${r.resourceId} is ${ageDays} days old`,
            reason: "Snapshots older than a year are often no longer needed for recovery.",
            evidence: { ageDays, sourceVolumeSizeGiB: a.sizeGiB, volumeId: a.volumeId },
            impact: price !== null ? `Up to about $${money(a.sizeGiB * price)}/month (upper bound).` : "Ongoing snapshot storage charges.",
            recommendation: "Check retention requirements and backup policies; delete snapshots that are no longer required, or archive them.",
            limitations: `Snapshots are incremental: billed size can be much smaller than the source volume size, so the figure is an upper bound. Compliance retention may require keeping it. ${price !== null ? PRICE_NOTE : ""}`.trim(),
            dataBasis: "HEURISTIC",
            confidence: "LOW",
            estimatedMonthlySavings: price !== null ? money(a.sizeGiB * price) : null,
          }),
        );
        break;
      }
      case "ec2:elastic-ip": {
        const a = r.attributes as ElasticIpAttrs;
        if (a.associationId) break;
        const hourly = prices.publicIpv4Hourly(r.region);
        out.push(
          base(r, {
            ruleId: "EIP-UNASSOCIATED",
            category: "network",
            title: `Elastic IP ${a.publicIp ?? r.resourceId} is not associated`,
            reason: "Unassociated Elastic IPs are billed hourly as idle public IPv4 addresses.",
            evidence: { publicIp: a.publicIp, allocationId: a.allocationId, associated: false, idleHourlyUsd: hourly },
            impact: hourly !== null ? `About $${money(hourly * HOURS_PER_MONTH)}/month.` : "Hourly idle IPv4 charges.",
            recommendation: "Release the address if it is not reserved for a planned use (e.g. allow-listed by partners).",
            limitations: `Released addresses cannot be recovered. ${hourly !== null ? PRICE_NOTE : "No list price was available, so no savings figure is shown."}`,
            dataBasis: hourly !== null ? "ESTIMATED" : "CONFIRMED",
            confidence: "HIGH",
            estimatedMonthlySavings: hourly !== null ? money(hourly * HOURS_PER_MONTH) : null,
          }),
        );
        break;
      }
      case "ec2:instance": {
        const a = r.attributes as Ec2InstanceAttrs;
        if (r.state === "stopped") {
          const stoppedDays = a.stoppedAt ? Math.floor((now.getTime() - new Date(a.stoppedAt).getTime()) / DAY) : null;
          if (stoppedDays === null || stoppedDays < 14) break;
          const attached = a.volumeIds.map((id) => volumes.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v));
          let storage: number | null = 0;
          for (const v of attached) {
            const va = v.attributes as EbsVolumeAttrs;
            const p = va.volumeType ? prices.ebsGbMonth(v.region, va.volumeType) : null;
            storage = p === null || storage === null ? null : storage + p * va.sizeGiB;
          }
          const totalGiB = attached.reduce((s, v) => s + (v.attributes as EbsVolumeAttrs).sizeGiB, 0);
          out.push(
            base(r, {
              ruleId: "EC2-STOPPED-LONG",
              category: "idle",
              title: `${label(r)} has been stopped for ${stoppedDays} days`,
              reason: "Stopped instances are not billed for compute, but their EBS volumes (and any Elastic IPs) keep incurring charges.",
              evidence: { state: "stopped", stoppedAt: a.stoppedAt, stoppedDays, attachedVolumeGiB: totalGiB, instanceType: a.instanceType },
              impact: storage !== null && attached.length ? `About $${money(storage)}/month of attached EBS storage.` : "Ongoing EBS storage charges.",
              recommendation: "If no longer needed, create an AMI/snapshot for safekeeping and terminate the instance.",
              limitations: `The instance may be a deliberately parked standby. Savings assume the attached volumes are deleted. ${storage !== null && attached.length ? PRICE_NOTE : ""}`.trim(),
              dataBasis: "HEURISTIC",
              confidence: "MEDIUM",
              estimatedMonthlySavings: storage !== null && attached.length ? money(storage) : null,
            }),
          );
          break;
        }
        if (r.state !== "running") break;
        const cpu = input.cpu.get(r.resourceId);
        if (!cpu || cpu.avg === null || cpu.max === null || cpu.datapoints < 10) break;
        if (cpu.avg < 5 && cpu.max < 20) {
          const hourly = prices.instanceHourly(r.region, a.instanceType);
          const saving = hourly !== null ? hourly * HOURS_PER_MONTH * 0.5 : null;
          const idle = cpu.max < 5;
          out.push(
            base(r, {
              ruleId: idle ? "EC2-IDLE" : "EC2-UNDERUTILIZED",
              category: "rightsizing",
              title: idle ? `${label(r)} looks idle (max CPU ${cpu.max.toFixed(1)}% over 14 days)` : `${label(r)} is underutilised (avg CPU ${cpu.avg.toFixed(1)}%)`,
              reason: `Over the last ${cpu.datapoints} days, average CPU was ${cpu.avg.toFixed(1)}% and daily peak never exceeded ${cpu.max.toFixed(1)}%.`,
              evidence: { instanceType: a.instanceType, cpuAverage14d: Number(cpu.avg.toFixed(2)), cpuDailyMax14d: Number(cpu.max.toFixed(2)), days: cpu.datapoints, onDemandHourlyUsd: hourly },
              impact: saving !== null ? `Roughly $${money(saving)}/month if downsized one size (≈50% of the on-demand price).` : "Lower compute cost if downsized or stopped.",
              recommendation: idle ? "Confirm the instance is still needed; stop or terminate it if not." : "Consider the next smaller size in the same family (or a burstable/Graviton type) after load testing.",
              limitations: `CPU alone ignores memory, network and disk pressure; memory is not published to CloudWatch without the agent. One-size-down ≈ half price holds for most families. ${saving !== null ? PRICE_NOTE : "No list price was available, so no savings figure is shown."}`,
              dataBasis: saving !== null ? "ESTIMATED" : "HEURISTIC",
              confidence: idle ? "MEDIUM" : "LOW",
              estimatedMonthlySavings: saving !== null ? money(saving) : null,
            }),
          );
        }
        break;
      }
      case "s3:bucket": {
        const a = r.attributes as S3BucketAttrs;
        if (!a.lifecycleRuleCount.ok || a.lifecycleRuleCount.value > 0) break;
        out.push(
          base(r, {
            ruleId: "S3-NO-LIFECYCLE",
            category: "storage",
            title: `S3 bucket ${r.resourceId} has no lifecycle rules`,
            reason: "Without lifecycle rules, objects (and noncurrent versions) stay in their original storage class indefinitely.",
            evidence: { lifecycleRules: 0, versioning: a.versioning.ok ? a.versioning.value : "unknown" },
            impact: "Potential savings by transitioning cold data to cheaper classes and expiring noncurrent versions.",
            recommendation: "Review access patterns (S3 Storage Lens / Storage Class Analysis) and add transition/expiration rules, or enable Intelligent-Tiering.",
            limitations: "Bucket size and access patterns are not collected by Stratus, so savings cannot be estimated; small or hot buckets may not benefit.",
            dataBasis: "HEURISTIC",
            confidence: "LOW",
            estimatedMonthlySavings: null,
          }),
        );
        break;
      }
    }

    // Governance: required tags on taggable, billable resources.
    if (input.requiredTagKeys.length && ["ec2:instance", "ec2:volume", "s3:bucket", "rds:db-instance", "lambda:function", "dynamodb:table", "elb:load-balancer"].includes(r.resourceType)) {
      const tags = r.tags ?? {};
      const missing = input.requiredTagKeys.filter((k) => !(k in tags));
      if (missing.length) {
        out.push(
          base(r, {
            ruleId: "TAGS-MISSING",
            category: "governance",
            title: `${label(r)} is missing required tag${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
            reason: "Required tags drive cost allocation and ownership; untagged resources cannot be attributed.",
            evidence: { missing, present: Object.keys(tags).slice(0, 20) },
            impact: "Spend cannot be allocated to a team/environment; orphaned resources are harder to find.",
            recommendation: `Add the missing tag(s) and consider enforcing them with AWS Organizations tag policies.`,
            limitations: "Required keys are configured per workspace; the resource type may be excluded from your tagging policy.",
            dataBasis: "CONFIRMED",
            confidence: "HIGH",
            estimatedMonthlySavings: null,
          }),
        );
      }
    }
  }
  return out;
}
