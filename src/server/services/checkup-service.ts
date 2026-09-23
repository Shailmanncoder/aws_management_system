import "server-only";
import { CHECKS, type CheckCopy, type CheckUrgency } from "@/lib/checkup";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";

/**
 * Works out which plain-language checks apply to this workspace.
 *
 * Every signal is read from data Stratus has already collected for THIS organization, so a
 * check-up can never describe another tenant's account. Where Stratus has not looked yet, the
 * check says so rather than reporting "all good" — claiming something is fine when it has not
 * been examined would be the most damaging thing this page could do.
 */

export interface CheckResult extends CheckCopy {
  urgency: CheckUrgency;
  /** Plain-language count, e.g. "3 storage folders". Empty when there is nothing to count. */
  detail: string;
  /** True when this check passed. */
  ok: boolean;
  /** True when Stratus has not gathered enough to judge. */
  unknown: boolean;
}

const RULE_GROUPS = {
  publicStorage: ["S3-PUBLIC", "S3-BPA-OFF"],
  openPorts: ["SG-OPEN", "SG-WIDE"],
  noEncryption: ["EBS-UNENCRYPTED", "RDS-UNENCRYPTED", "RDS-CLUSTER-UNENCRYPTED", "SNAPSHOT-UNENCRYPTED"],
  noBackups: ["RDS-NO-BACKUP"],
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface Checkup {
  results: CheckResult[];
  counts: Record<CheckUrgency, number>;
  /** True when nothing has been examined yet, so the page should not imply everything is fine. */
  nothingExaminedYet: boolean;
}

export async function getCheckup(access: OrgAccess): Promise<Checkup> {
  assertCan(access, "inventory:read");
  const db = getDb();
  const organizationId = access.organizationId;

  const [accounts, findingRows, savings, governance, alertRuleCount, user, costRows, lastCostJob] = await Promise.all([
    db.awsAccount.findMany({
      where: { organizationId },
      select: { id: true, syncStatus: true, connection: { select: { status: true } } },
    }),
    db.securityFinding.groupBy({
      by: ["ruleId"],
      where: { organizationId, status: "OPEN" },
      _count: { _all: true },
    }),
    db.optimizationFinding.aggregate({
      where: { organizationId, status: "OPEN", estimatedMonthlySavings: { not: null } },
      _sum: { estimatedMonthlySavings: true },
      _count: { _all: true },
    }),
    db.optimizationFinding.count({ where: { organizationId, status: "OPEN", category: "governance" } }),
    db.alertRule.count({ where: { organizationId, enabled: true } }),
    db.user.findUnique({ where: { id: access.userId }, select: { twoFactorEnabled: true } }),
    db.costRecord.count({ where: { organizationId, amount: { not: 0 } }, take: 1 }),
    db.syncJob.findFirst({
      where: { organizationId, type: "COST_SYNC" },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    }),
  ]);

  const findings = Object.fromEntries(findingRows.map((r) => [r.ruleId, r._count._all])) as Record<string, number>;
  const countFor = (group: readonly string[]) => group.reduce((sum, rule) => sum + (findings[rule] ?? 0), 0);

  const connected = accounts.filter((a) => a.connection && ["CONNECTED", "NEEDS_ATTENTION", "PERMISSION_PROBLEM"].includes(a.connection.status));
  const everSynced = accounts.some((a) => a.syncStatus === "SUCCEEDED" || a.syncStatus === "PARTIAL");
  const failing = accounts.filter((a) => a.syncStatus === "FAILED" || a.connection?.status === "PERMISSION_PROBLEM");
  // Until the first successful look, we know nothing about what is inside the account.
  const examined = connected.length > 0 && everSynced;

  const results: CheckResult[] = [];
  const add = (copy: CheckCopy, state: { ok: boolean; urgency: CheckUrgency; detail?: string; unknown?: boolean }) =>
    results.push({ ...copy, ok: state.ok, urgency: state.ok ? "done" : state.urgency, detail: state.detail ?? "", unknown: state.unknown ?? false });

  // ── Getting started ──────────────────────────────────────────────────────
  add(CHECKS.connectAccount!, {
    ok: connected.length > 0,
    urgency: "now",
    detail: connected.length > 0 ? plural(connected.length, "account connected", "accounts connected") : "",
  });

  if (connected.length > 0) {
    add(CHECKS.firstSync!, { ok: everSynced, urgency: "now" });
  }
  if (connected.length > 0 && everSynced) {
    add(CHECKS.syncFailing!, {
      ok: failing.length === 0,
      urgency: "now",
      detail: failing.length ? plural(failing.length, "account has a problem", "accounts have a problem") : "",
    });
  }

  // ── Money ────────────────────────────────────────────────────────────────
  if (connected.length > 0) {
    const billingWorks = costRows > 0;
    add(CHECKS.billingOff!, {
      ok: billingWorks,
      urgency: "soon",
      detail: billingWorks ? "" : lastCostJob?.status === "FAILED" ? "Amazon refused the last attempt" : "No spending figures yet",
    });
  }

  // ── Safety checks, only once we have actually looked ──────────────────────
  const safetyChecks: [CheckCopy, readonly string[], CheckUrgency, [string, string]][] = [
    [CHECKS.publicStorage!, RULE_GROUPS.publicStorage, "now", ["storage folder is open to the public", "storage folders are open to the public"]],
    [CHECKS.openPorts!, RULE_GROUPS.openPorts, "now", ["machine is open to the internet", "machines are open to the internet"]],
    [CHECKS.noEncryption!, RULE_GROUPS.noEncryption, "soon", ["disk or database is not scrambled", "disks or databases are not scrambled"]],
    [CHECKS.noBackups!, RULE_GROUPS.noBackups, "now", ["database has no backups", "databases have no backups"]],
  ];
  for (const [copy, group, urgency, [one, many]] of safetyChecks) {
    const n = countFor(group);
    add(copy, {
      ok: examined && n === 0,
      urgency,
      detail: n > 0 ? plural(n, one, many) : "",
      unknown: !examined,
    });
  }

  // ── Waste ────────────────────────────────────────────────────────────────
  if (examined) {
    const monthly = savings._sum.estimatedMonthlySavings ? Number(savings._sum.estimatedMonthlySavings.toString()) : 0;
    add(CHECKS.wastingMoney!, {
      ok: savings._count._all === 0,
      urgency: "soon",
      detail: savings._count._all > 0 ? `${plural(savings._count._all, "thing", "things")}, roughly USD ${monthly.toFixed(2)} a month` : "",
    });
    add(CHECKS.untagged!, {
      ok: governance === 0,
      urgency: "whenever",
      detail: governance > 0 ? plural(governance, "thing is missing labels", "things are missing labels") : "",
    });
  }

  // ── Stratus itself ───────────────────────────────────────────────────────
  add(CHECKS.noAlerts!, {
    ok: alertRuleCount > 0,
    urgency: "soon",
    detail: alertRuleCount > 0 ? plural(alertRuleCount, "alert is on", "alerts are on") : "",
  });
  add(CHECKS.noTwoFactor!, { ok: Boolean(user?.twoFactorEnabled), urgency: "soon" });

  const counts: Record<CheckUrgency, number> = { now: 0, soon: 0, whenever: 0, done: 0 };
  for (const r of results) counts[r.urgency] += 1;

  return { results, counts, nothingExaminedYet: !examined };
}
