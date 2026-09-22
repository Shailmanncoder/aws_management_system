import "server-only";
import type { Permission } from "@/lib/rbac";
import { ALL_RESOURCE_TYPES, type ResourceType } from "@/lib/resource-types";
import { assertCan, type OrgAccess } from "../authz/guard";
import { AppError } from "../errors";
import { csvRow } from "../security/csv";
import { AUDIT, recordAudit } from "./audit-service";
import { listInventory, parseListParams } from "./inventory-service";

export const REPORTS = ["inventory", "cost", "security", "optimization", "audit"] as const;
export type ReportKind = (typeof REPORTS)[number];

/** Each report requires the export permission AND read access to its dataset. */
export const REPORT_PERMISSION: Record<ReportKind, Permission> = {
  inventory: "inventory:read",
  cost: "cost:read",
  security: "security:read",
  optimization: "optimization:read",
  audit: "audit:read",
};

export const MAX_EXPORT_ROWS = 50_000;

export type ReportGenerator = (access: OrgAccess, params: Record<string, string>) => AsyncGenerator<string>;

const generators = new Map<ReportKind, ReportGenerator>();
export function registerReport(kind: ReportKind, gen: ReportGenerator) {
  generators.set(kind, gen);
}

/** Inventory CSV: pages through the same tenant-scoped query the UI uses. */
registerReport("inventory", async function* (access, raw) {
  const params = parseListParams(raw);
  const types: ResourceType[] = params.type ? [params.type] : [...ALL_RESOURCE_TYPES];
  yield csvRow(["account_id", "account_name", "type", "region", "resource_id", "name", "state", "arn", "first_seen", "last_seen", "tags"]);
  let emitted = 0;
  for (let page = 1; emitted < MAX_EXPORT_ROWS; page++) {
    const res = await listInventory(access, types, { ...params, page, pageSize: 100 });
    for (const r of res.items) {
      yield csvRow([r.account.awsAccountId, r.account.displayName, r.resourceType, r.region, r.resourceId, r.name, r.state, r.arn, r.firstSeenAt, r.lastSeenAt, r.tags.map((t) => `${t.key}=${t.value}`).join("; ")]);
    }
    emitted += res.items.length;
    if (res.items.length < 100) break;
  }
});

export async function buildExport(access: OrgAccess, kind: ReportKind, params: Record<string, string>): Promise<ReadableStream<Uint8Array>> {
  assertCan(access, "reports:export");
  assertCan(access, REPORT_PERMISSION[kind]);
  const gen = generators.get(kind);
  if (!gen) throw new AppError("NOT_FOUND", "Report not available.");
  await recordAudit({
    action: AUDIT.REPORT_EXPORTED,
    organizationId: access.organizationId,
    actorUserId: access.userId,
    outcome: "SUCCESS",
    targetType: "report",
    targetId: kind,
    metadata: { filters: Object.keys(params) },
  });
  const encoder = new TextEncoder();
  const iterator = gen(access, params);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
