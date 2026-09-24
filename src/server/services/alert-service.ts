import "server-only";
import { costSpikes } from "@/lib/operations-insights";
import { z } from "zod";
import type { AlertType, Prisma, Severity } from "@/generated/prisma/client";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { notFound } from "../errors";
import { logger } from "../logging/logger";
import { AUDIT, recordAudit } from "./audit-service";

/**
 * Alerting. Rules are evaluated after every sync (inventory + cost). Alerts are deduplicated by
 * a deterministic key, carry only minimal non-sensitive context (ids/counts), and are delivered
 * IN_APP. External channels (email/Slack/webhook) are an interface only: user-supplied webhook
 * URLs are an SSRF vector and require an egress proxy with an allow-list before enabling.
 */

export const ALERT_TYPES = ["COST_THRESHOLD", "COST_ANOMALY", "PUBLIC_EXPOSURE", "NEW_SECURITY_FINDING", "EC2_STOPPED", "SYNC_FAILURE", "CONFIG_CHANGE"] as const;

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFORMATIONAL: 1 };

export const ruleConfigSchemas = {
  COST_THRESHOLD: z.strictObject({ monthToDateAmount: z.number().positive().max(1e9), currency: z.string().regex(/^[A-Z]{3}$/).default("USD"), scope: z.enum(["ACCOUNT", "WORKSPACE"]).default("ACCOUNT"), warningPercent: z.number().int().min(1).max(100).default(100) }),
  COST_ANOMALY: z.strictObject({ percentAboveBaseline: z.number().min(5).max(1000).default(30), minDailyAmount: z.number().min(0).max(1e9).default(10) }),
  PUBLIC_EXPOSURE: z.strictObject({}),
  NEW_SECURITY_FINDING: z.strictObject({ minSeverity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]).default("HIGH") }),
  EC2_STOPPED: z.strictObject({}),
  SYNC_FAILURE: z.strictObject({}),
  CONFIG_CHANGE: z.strictObject({ resourceTypes: z.array(z.string().regex(/^[a-z0-9]+:[a-z0-9-]+$/)).max(30).default(["ec2:security-group", "s3:bucket", "ec2:instance"]) }),
} satisfies Record<AlertType, z.ZodType>;

export const alertRuleInput = z.discriminatedUnion("type", ALERT_TYPES.map((t) => z.strictObject({ type: z.literal(t), name: z.string().trim().min(2).max(80).regex(/^[^\u0000-\u001F<>]+$/), enabled: z.boolean().default(true), config: ruleConfigSchemas[t] })) as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);
export type AlertRuleInput = z.infer<typeof alertRuleInput> & { type: AlertType; name: string; enabled: boolean; config: Record<string, unknown> };

export const RECOMMENDED_RULES: AlertRuleInput[] = [
  { type: "PUBLIC_EXPOSURE", name: "New public exposure", enabled: true, config: {} },
  { type: "NEW_SECURITY_FINDING", name: "New high/critical security finding", enabled: true, config: { minSeverity: "HIGH" } },
  { type: "COST_ANOMALY", name: "Daily spend anomaly (+30%)", enabled: true, config: { percentAboveBaseline: 30, minDailyAmount: 10 } },
  { type: "EC2_STOPPED", name: "EC2 instance stopped", enabled: true, config: {} },
  { type: "SYNC_FAILURE", name: "Sync failure", enabled: true, config: {} },
  { type: "CONFIG_CHANGE", name: "Security-relevant configuration change", enabled: true, config: { resourceTypes: ["ec2:security-group", "s3:bucket"] } },
];

// ─────────────────────────── Rule management ───────────────────────────

export async function listAlertRules(access: OrgAccess) {
  assertCan(access, "alerts:read");
  return getDb().alertRule.findMany({ where: { organizationId: access.organizationId }, orderBy: { createdAt: "asc" } });
}

export async function createAlertRule(access: OrgAccess, input: AlertRuleInput) {
  assertCan(access, "alerts:manage");
  const rule = await getDb().alertRule.create({
    data: { organizationId: access.organizationId, type: input.type, name: input.name, enabled: input.enabled, config: input.config as Prisma.InputJsonValue, channels: ["IN_APP"], createdById: access.userId },
  });
  await recordAudit({ action: AUDIT.ALERT_RULE_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "alert_rule", targetId: rule.id, metadata: { op: "create", type: input.type } });
  return rule;
}

export async function enableRecommendedRules(access: OrgAccess) {
  assertCan(access, "alerts:manage");
  const existing = new Set((await listAlertRules(access)).map((r) => r.type));
  const created = [];
  for (const r of RECOMMENDED_RULES) if (!existing.has(r.type)) created.push(await createAlertRule(access, r));
  return created.length;
}

export async function updateAlertRule(access: OrgAccess, id: string, patch: { enabled?: boolean; name?: string }) {
  assertCan(access, "alerts:manage");
  const res = await getDb().alertRule.updateMany({ where: { id, organizationId: access.organizationId }, data: patch });
  if (res.count === 0) throw notFound("Alert rule");
  await recordAudit({ action: AUDIT.ALERT_RULE_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "alert_rule", targetId: id, metadata: { op: "update", ...patch } });
}

export async function deleteAlertRule(access: OrgAccess, id: string) {
  assertCan(access, "alerts:manage");
  const res = await getDb().alertRule.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (res.count === 0) throw notFound("Alert rule");
  await recordAudit({ action: AUDIT.ALERT_RULE_CHANGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "alert_rule", targetId: id, metadata: { op: "delete" } });
}

// ─────────────────────────── Alerts ───────────────────────────

const alertParams = z.object({ status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional().catch(undefined), page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1) });

export async function listAlerts(access: OrgAccess, raw: Record<string, string | string[] | undefined>) {
  assertCan(access, "alerts:read");
  const p = alertParams.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const where = { organizationId: access.organizationId, status: p.status ?? { in: ["OPEN" as const, "ACKNOWLEDGED" as const] } };
  const [items, total] = await Promise.all([
    getDb().alert.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * 25, take: 25, include: { awsAccount: { select: { displayName: true } }, rule: { select: { name: true } } } }),
    getDb().alert.count({ where }),
  ]);
  return { items, total, page: p.page, pageSize: 25 };
}

export const alertStateInput = z.strictObject({ status: z.enum(["ACKNOWLEDGED", "RESOLVED"]) });

export async function setAlertState(access: OrgAccess, id: string, status: "ACKNOWLEDGED" | "RESOLVED") {
  assertCan(access, "alerts:acknowledge");
  const res = await getDb().alert.updateMany({
    where: { id, organizationId: access.organizationId, status: { not: "RESOLVED" } },
    data: { status, acknowledgedAt: new Date(), acknowledgedBy: access.userId },
  });
  if (res.count === 0) throw notFound("Alert");
  await recordAudit({ action: AUDIT.ALERT_ACKNOWLEDGED, organizationId: access.organizationId, actorUserId: access.userId, outcome: "SUCCESS", targetType: "alert", targetId: id, metadata: { status } });
}

// ─────────────────────────── Evaluation ───────────────────────────

interface Emit {
  type: AlertType;
  accountRefId?: string | null;
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  dedupeKey: string;
  context?: Record<string, string | number | boolean | null>;
}

/**
 * Evaluates enabled rules for one account. Idempotent: dedupe keys make repeated evaluation
 * create each alert once. `since` bounds "new" events to the previous evaluation window.
 */
export async function evaluateAlerts(organizationId: string, accountRefId: string, since: Date): Promise<number> {
  const db = getDb();
  const rules = await db.alertRule.findMany({ where: { organizationId, enabled: true } });
  if (rules.length === 0) return 0;
  const account = await db.awsAccount.findFirst({ where: { id: accountRefId, organizationId }, select: { displayName: true, syncStatus: true, syncError: true, lastSyncedAt: true } });
  if (!account) return 0;
  const emits: Emit[] = [];
  const day = new Date().toISOString().slice(0, 10);

  for (const rule of rules) {
    try {
      switch (rule.type) {
        case "NEW_SECURITY_FINDING": {
          const cfg = ruleConfigSchemas.NEW_SECURITY_FINDING.parse(rule.config);
          const fresh = await db.securityFinding.findMany({ where: { organizationId, awsAccountRefId: accountRefId, status: "OPEN", firstSeenAt: { gte: since } }, select: { id: true, severity: true, title: true, ruleId: true }, take: 200 });
          for (const f of fresh.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[cfg.minSeverity])) {
            emits.push({ type: rule.type, ruleId: rule.id, severity: f.severity, title: f.title, message: `New ${f.severity.toLowerCase()} security finding in ${account.displayName}.`, dedupeKey: `finding:${f.id}`, context: { findingId: f.id, rule: f.ruleId } });
          }
          break;
        }
        case "PUBLIC_EXPOSURE": {
          const fresh = await db.securityFinding.findMany({ where: { organizationId, awsAccountRefId: accountRefId, status: "OPEN", firstSeenAt: { gte: since }, ruleId: { in: ["S3-PUBLIC", "SG-OPEN", "RDS-PUBLIC", "EKS-PUBLIC-ENDPOINT"] } }, select: { id: true, title: true, severity: true }, take: 200 });
          for (const f of fresh) emits.push({ type: rule.type, ruleId: rule.id, severity: f.severity, title: `Public exposure: ${f.title}`, message: `A newly detected configuration exposes a resource to the internet in ${account.displayName}.`, dedupeKey: `exposure:${f.id}`, context: { findingId: f.id } });
          break;
        }
        case "EC2_STOPPED": {
          const stopped = await db.awsResource.findMany({ where: { organizationId, awsAccountRefId: accountRefId, resourceType: "ec2:instance", state: "stopped", deletedAt: null }, select: { id: true, resourceId: true, name: true, attributes: true }, take: 500 });
          for (const r of stopped) {
            const stoppedAt = (r.attributes as { stoppedAt?: string | null }).stoppedAt;
            if (!stoppedAt || new Date(stoppedAt) < since) continue;
            emits.push({ type: rule.type, ruleId: rule.id, severity: "MEDIUM", title: `EC2 instance ${r.name ?? r.resourceId} stopped`, message: `The instance entered the stopped state at ${stoppedAt}.`, dedupeKey: `stopped:${r.id}:${stoppedAt}`, context: { resourceRefId: r.id } });
          }
          break;
        }
        case "SYNC_FAILURE": {
          if (account.syncStatus === "FAILED" || account.syncStatus === "PARTIAL") {
            emits.push({ type: rule.type, ruleId: rule.id, severity: account.syncStatus === "FAILED" ? "HIGH" : "LOW", title: `Sync ${account.syncStatus.toLowerCase()} for ${account.displayName}`, message: account.syncError ?? "The last synchronisation did not complete.", dedupeKey: `sync:${accountRefId}:${account.syncStatus}:${day}` });
          }
          break;
        }
        case "CONFIG_CHANGE": {
          const cfg = ruleConfigSchemas.CONFIG_CHANGE.parse(rule.config);
          const [created, removed] = await Promise.all([
            db.awsResource.count({ where: { organizationId, awsAccountRefId: accountRefId, resourceType: { in: cfg.resourceTypes }, firstSeenAt: { gte: since } } }),
            db.awsResource.count({ where: { organizationId, awsAccountRefId: accountRefId, resourceType: { in: cfg.resourceTypes }, deletedAt: { gte: since } } }),
          ]);
          const modified = await db.awsResource.count({ where: { organizationId, awsAccountRefId: accountRefId, resourceType: { in: cfg.resourceTypes }, updatedAt: { gte: since }, firstSeenAt: { lt: since }, deletedAt: null } });
          // "modified" counts rows whose normalised attributes were rewritten; only report when resources were added/removed to avoid noise.
          if (created + removed > 0) {
            emits.push({ type: rule.type, ruleId: rule.id, severity: "LOW", title: `${created} added / ${removed} removed resource(s) in ${account.displayName}`, message: `Watched types: ${cfg.resourceTypes.join(", ")}.`, dedupeKey: `config:${accountRefId}:${since.toISOString()}`, context: { created, removed, refreshed: modified } });
          }
          break;
        }
        case "COST_THRESHOLD": {
          const cfg = ruleConfigSchemas.COST_THRESHOLD.parse(rule.config);
          const now = new Date();
          const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const workspace = cfg.scope === "WORKSPACE";
          const agg = await db.costRecord.aggregate({ where: { organizationId, ...(workspace ? {} : { awsAccountRefId: accountRefId }), awsAccount: { costScopeVersion: 1 }, granularity: "DAILY", dimension: "TOTAL", periodStart: { gte: monthStart, lte: now }, unit: cfg.currency }, _sum: { amount: true } });
          const mtd = agg._sum.amount ? Number(agg._sum.amount.toString()) : 0;
          const reached = mtd >= cfg.monthToDateAmount;
          if (mtd >= cfg.monthToDateAmount * cfg.warningPercent / 100) {
            const label = workspace ? "Workspace" : account.displayName;
            emits.push({ type: rule.type, ruleId: rule.id, accountRefId: workspace ? null : accountRefId, severity: reached ? "HIGH" : "MEDIUM", title: `${label}: ${reached ? "budget reached" : "budget warning"} (${cfg.currency})`, message: `Spending is ${mtd.toFixed(2)} ${cfg.currency} against a monthly budget of ${cfg.monthToDateAmount} ${cfg.currency}. AWS amounts may be estimated. This alert does not stop spending.`, dedupeKey: `threshold:${workspace ? "workspace" : accountRefId}:${rule.id}:${monthStart.toISOString().slice(0, 7)}:${reached ? "limit" : "warning"}`, context: { amount: Math.round(mtd * 100) / 100, currency: cfg.currency } });
          }
          break;
        }
        case "COST_ANOMALY": {
          const cfg = ruleConfigSchemas.COST_ANOMALY.parse(rule.config);
          const rows = await db.costRecord.findMany({ where: { organizationId, awsAccountRefId: accountRefId, awsAccount: { costScopeVersion: 1 }, granularity: "DAILY", dimension: { in: ["TOTAL", "SERVICE"] }, periodStart: { gte: new Date(Date.now() - 10 * 86400000) } } });
          for (const spike of costSpikes(rows.map(r => ({ ...r, amount: Number(r.amount), periodStart: r.periodStart.toISOString() })), new Date(), cfg.percentAboveBaseline, cfg.minDailyAmount)) {
            const drivers = spike.services.map(s => `${s.service}: ${s.amount.toFixed(2)} ${spike.currency}${s.increase === null ? " (baseline unavailable)" : ` (${s.increase >= 0 ? "+" : ""}${s.increase.toFixed(2)} vs daily baseline)`}`).join("; ");
            emits.push({ type: rule.type, ruleId: rule.id, severity: "MEDIUM", title: `Spend anomaly on ${spike.day}: +${Math.round(spike.percent)}% (${account.displayName})`, message: `Daily spend ${spike.amount.toFixed(2)} ${spike.currency}; previous 7-day average ${spike.average.toFixed(2)}. ${drivers}. Billing may be delayed or estimated; this is a signal, not a confirmed cause.`, dedupeKey: `anomaly:${accountRefId}:${rule.id}:${spike.currency}:${spike.day}`, context: { pct: Math.round(spike.percent), currency: spike.currency, day: spike.day } });
          }
          break;
        }
      }
    } catch (err) {
      logger.warn("alert rule evaluation failed", { ruleType: rule.type, err });
    }
  }

  let created = 0;
  for (const e of emits) {
    const res = await db.alert.createMany({
      data: [{ organizationId, ruleId: e.ruleId, awsAccountRefId: e.accountRefId === undefined ? accountRefId : e.accountRefId, type: e.type, severity: e.severity, title: e.title.slice(0, 300), message: e.message.slice(0, 1000), context: e.context, dedupeKey: e.dedupeKey }],
      skipDuplicates: true,
    });
    created += res.count;
  }
  if (created > 0) logger.info("alerts created", { created });
  return created;
}
