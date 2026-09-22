import "server-only";
import { listSecurityFindings } from "./findings-service";
import { resolveRange } from "@/lib/cost-math";
import { getDb } from "../db";
import { csvRow } from "../security/csv";
import { parseCostParams } from "./cost-service";
import { MAX_EXPORT_ROWS, registerReport } from "./export-service";

/** Cost report: daily rows per account × dimension for the selected range. */
registerReport("cost", async function* (access, raw) {
  const p = parseCostParams(raw);
  const { start, end } = resolveRange(p.range, new Date(), p.from && p.to ? { from: p.from, to: p.to } : undefined);
  yield csvRow(["date", "account_id", "account_name", "dimension", "key", "amount", "unit", "estimated"]);
  let cursor: string | undefined;
  let emitted = 0;
  while (emitted < MAX_EXPORT_ROWS) {
    const rows = await getDb().costRecord.findMany({
      where: {
        organizationId: access.organizationId,
        granularity: "DAILY",
        awsAccount: { costScopeVersion: 1 },
        ...(p.currency ? { unit: p.currency } : {}),
        ...(p.region ? { dimension: "REGION", dimensionKey: p.region } : {}),
        periodStart: { gte: start, lte: end },
        ...(p.account ? { awsAccountRefId: p.account } : {}),
      },
      orderBy: [{ periodStart: "asc" }, { id: "asc" }],
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, periodStart: true, dimension: true, dimensionKey: true, amount: true, unit: true, estimated: true, awsAccount: { select: { awsAccountId: true, displayName: true } } },
    });
    for (const r of rows) {
      yield csvRow([r.periodStart.toISOString().slice(0, 10), r.awsAccount.awsAccountId, r.awsAccount.displayName, r.dimension, r.dimensionKey, r.amount.toString(), r.unit, r.estimated]);
    }
    emitted += rows.length;
    if (rows.length < 1000) break;
    cursor = rows[rows.length - 1]!.id;
  }
});

registerReport("security", async function* (access, raw) {
  yield csvRow(["account", "region", "severity", "status", "source", "rule", "title", "description", "rationale", "evidence", "remediation", "last_seen"]);
  let emitted = 0;
  for (let page = 1; emitted < MAX_EXPORT_ROWS; page++) {
    const res = await listSecurityFindings(access, { ...raw, page: String(page) });
    for (const f of res.items) {
      yield csvRow([f.awsAccount.awsAccountId, f.region, f.severity, f.status, f.source, f.ruleId, f.title, f.description, f.rationale, JSON.stringify(f.evidence), f.remediation, f.lastSeenAt.toISOString()]);
    }
    emitted += res.items.length;
    if (res.items.length < res.pageSize) break;
  }
});

/** Optimisation report: open recommendations with basis, confidence and savings (if estimated). */
registerReport("optimization", async function* (access, raw) {
  const { listOptimizationFindings } = await import("./optimization-service");
  yield csvRow(["account", "region", "category", "rule", "title", "resource", "data_basis", "confidence", "est_monthly_savings_usd", "recommendation", "limitations", "status"]);
  let emitted = 0;
  for (let page = 1; emitted < MAX_EXPORT_ROWS; page++) {
    const res = await listOptimizationFindings(access, { ...raw, page: String(page) });
    for (const f of res.items) {
      yield csvRow([f.awsAccount.displayName, f.region, f.category, f.ruleId, f.title, f.resource?.resourceId ?? "", f.dataBasis, f.confidence, f.estimatedMonthlySavings?.toString() ?? "", f.recommendation, f.limitations, f.status]);
    }
    emitted += res.items.length;
    if (res.items.length < res.pageSize) break;
  }
});

/** Audit report (append-only trail). IP addresses are included only for audit readers. */
registerReport("audit", async function* (access, raw) {
  const { getAuditLog } = await import("./audit-query-service");
  yield csvRow(["time", "actor", "actor_type", "action", "target_type", "target_id", "outcome", "request_id", "ip"]);
  let cursor: string | undefined;
  let emitted = 0;
  while (emitted < MAX_EXPORT_ROWS) {
    const page = await getAuditLog(access, { ...raw, ...(cursor ? { cursor } : {}) }, 500);
    for (const e of page.items) yield csvRow([e.createdAt.toISOString(), e.actor?.email ?? "", e.actorType, e.action, e.targetType, e.targetId, e.outcome, e.requestId, e.ipAddress]);
    emitted += page.items.length;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
});
