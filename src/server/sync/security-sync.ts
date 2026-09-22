import "server-only";
import { LeaseLostError } from "../jobs/lease";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { collectSecuritySignals } from "../aws/security-signals";
import { globalRegionFor } from "../aws/regions-catalog";
import { getDb } from "../db";
import { evaluateAccountSignals, RESOURCE_RULES, type FindingDraft } from "../rules/security-rules";
import type { PostSyncContext } from "./post-sync";

/** Unknown observations may create positive findings, but can never resolve old findings. */
export function hasUnknownObservation(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("ok" in value && value.ok === false) return true;
  return Object.values(value).some(hasUnknownObservation);
}

export function findingFingerprint(account: string, source: string, rule: string, subject: string): string {
  return createHash("sha256").update(JSON.stringify([account, source, rule, subject])).digest("hex");
}

export async function runSecurityScan(ctx: PostSyncContext): Promise<void> {
  const db = getDb();
  const scope = { organizationId: ctx.organizationId, awsAccountRefId: ctx.accountRefId };
  const signals = await collectSecuritySignals(ctx.session, ctx.regions);
  const account = evaluateAccountSignals(signals, globalRegionFor(ctx.session.partition));
  const gaps: string[] = [...(ctx.inventoryGaps ?? [])];
  for (const key of ["accountSummary", "passwordPolicy", "accessKeys", "trails"] as const) {
    if (!signals[key].ok) gaps.push(key);
  }
  if (signals.trails.ok && signals.trails.value.some((t) => t.logging === null)) gaps.push("trail logging status");
  for (const [service, observations] of Object.entries({ guardDuty: signals.guardDuty, securityHub: signals.securityHub })) {
    for (const region of ctx.regions) {
      if (!observations[region]?.ok) gaps.push(`${service}: ${region}`);
    }
  }
  const now = new Date();
  if (!(await ctx.heartbeat())) throw new LeaseLostError();
  // Each batch commits independently; failed scans retain previous findings and scan coverage.
  const persist = async (tx: Prisma.TransactionClient, draft: FindingDraft, source: "STRATUS_RULE" | "GUARDDUTY" | "SECURITY_HUB" = "STRATUS_RULE") => {
    const fingerprint = findingFingerprint(ctx.accountRefId, source, draft.ruleId, draft.subjectKey);
    const { subjectKey: _subjectKey, ...values } = draft;
    void _subjectKey;
    const data = { ...values, evidence: values.evidence as Prisma.InputJsonValue, lastSeenAt: now };
    const key = { organizationId: ctx.organizationId, fingerprint };
    await tx.securityFinding.upsert({
      where: { organizationId_fingerprint: key },
      create: { ...scope, ...data, source, fingerprint },
      update: data,
    });
    // Recurrence reopens resolved findings. Explicit suppression survives subsequent scans.
    await tx.securityFinding.updateMany({ where: { ...key, status: "RESOLVED" }, data: { status: "OPEN", resolvedAt: null } });
    return fingerprint;
  };
  let cursor: string | undefined;
  let examined = 0;
  let incompleteResources = 0;
  for (;;) {
    const rows = await db.awsResource.findMany({
      where: { ...scope, deletedAt: null, resourceType: { in: RESOURCE_RULES.map((r) => r.resourceType!).filter(Boolean) } },
      orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    if (!(await ctx.heartbeat())) throw new LeaseLostError();
    await db.$transaction(async (tx) => {
      await ctx.fence?.(tx);
      for (const resource of rows) {
        if (resource.lastSeenAt < ctx.inventoryStartedAt) { incompleteResources++; continue; }
        examined++;
        const drafts = RESOURCE_RULES.filter((r) => r.resourceType === resource.resourceType).flatMap((r) => r.evaluate(resource));
        const seen: string[] = [];
        for (const draft of drafts) seen.push(await persist(tx, draft));
        if (hasUnknownObservation(resource.attributes)) { incompleteResources++; continue; }
        await tx.securityFinding.updateMany({
          where: { ...scope, source: "STRATUS_RULE", resourceRefId: resource.id, status: "OPEN", fingerprint: { notIn: seen } },
          data: { status: "RESOLVED", resolvedAt: now },
        });
      }
    }, { timeout: 30000 });
    cursor = rows.at(-1)!.id;
  }
  if (incompleteResources) gaps.push(`${incompleteResources} resource(s) with stale or unavailable checks`);
  if (!(await ctx.heartbeat())) throw new LeaseLostError();
  await db.$transaction(async (tx) => {
      await ctx.fence?.(tx);
    const seen: string[] = [];
    for (const draft of account.drafts) seen.push(await persist(tx, draft));
    for (const check of account.ranChecks) {
      const [ruleId, region] = check.split("|");
      await tx.securityFinding.updateMany({
        where: { ...scope, source: "STRATUS_RULE", resourceRefId: null, ruleId, ...(region ? { region } : {}), status: "OPEN", fingerprint: { notIn: seen } },
        data: { status: "RESOLVED", resolvedAt: now },
      });
    }
    const externalSeen: string[] = [];
    for (const f of signals.externalFindings) {
      externalSeen.push(await persist(tx, {
        ruleId: f.type ?? f.source, subjectKey: `${f.region}|${f.id}`, resourceRefId: null,
        severity: f.severity, title: f.title, description: f.description,
        rationale: `Reported by AWS ${f.source === "GUARDDUTY" ? "GuardDuty" : "Security Hub"}; review the source finding for context.`,
        evidence: { findingId: f.id, resource: f.resourceHint, updatedAt: f.updatedAt },
        remediation: f.remediation ?? "Review the source finding in the AWS console.", region: f.region,
      }, f.source));
    }
    for (const [source, observations] of [["GUARDDUTY", signals.guardDuty], ["SECURITY_HUB", signals.securityHub]] as const) {
      for (const [region, observation] of Object.entries(observations)) {
        // Disabling a service does not prove its previously reported risks were remediated.
        if (!observation.ok || !observation.value.enabled) continue;
        await tx.securityFinding.updateMany({
          where: { ...scope, source, region, status: "OPEN", fingerprint: { notIn: externalSeen } },
          data: { status: "RESOLVED", resolvedAt: now },
        });
      }
    }
    await tx.awsAccount.updateMany({ where: { organizationId: ctx.organizationId, id: ctx.accountRefId }, data: {
      securityScannedAt: now, securityCoverage: { gaps, examined, regions: ctx.regions },
    } });
  }, { timeout: 60000 });
}
