import "server-only";
import { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { GetFindingsCommand as GdGetFindings, GuardDutyClient, GetDetectorCommand, ListDetectorsCommand, ListFindingsCommand } from "@aws-sdk/client-guardduty";
import { GetAccountPasswordPolicyCommand, GetAccountSummaryCommand, IAMClient, ListAccessKeysCommand, ListUsersCommand } from "@aws-sdk/client-iam";
import { GetFindingsCommand as ShGetFindings, SecurityHubClient } from "@aws-sdk/client-securityhub";
import type { Observed } from "@/lib/resource-types";
import { createAwsClient } from "./client-factory";
import { observe } from "./collectors/types";
import { mapSettledLimit } from "./concurrency";
import { classifyAwsError } from "./errors";
import { paginate } from "./paginate";
import { globalRegionFor } from "./regions-catalog";
import type { AwsSession } from "./session";

/**
 * Account-level security signals. Every value is `Observed` so a denied/missing check is
 * reported as a coverage gap — never as "secure" and never as a fabricated finding.
 * Access key IDs are reduced to their last 4 characters immediately.
 */
export interface AccessKeyMeta {
  userName: string;
  keyHint: string;
  ageDays: number;
  active: boolean;
}

export interface ExternalFinding {
  source: "GUARDDUTY" | "SECURITY_HUB";
  id: string;
  region: string;
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
  resourceHint: string | null;
  type: string | null;
  updatedAt: string | null;
  remediation: string | null;
}

export interface SecuritySignals {
  accountSummary: Observed<{ rootMfaEnabled: boolean; rootAccessKeysPresent: boolean }>;
  passwordPolicy: Observed<boolean>;
  accessKeys: Observed<AccessKeyMeta[]>;
  trails: Observed<{ name: string; multiRegion: boolean; logging: boolean | null; homeRegion: string | null }[]>;
  guardDuty: Record<string, Observed<{ enabled: boolean }>>;
  externalFindings: ExternalFinding[];
  securityHub: Record<string, Observed<{ enabled: boolean }>>;
}

const DAY = 86_400_000;

export function guardDutySeverity(n: number): ExternalFinding["severity"] {
  if (n >= 9) return "CRITICAL";
  if (n >= 7) return "HIGH";
  if (n >= 4) return "MEDIUM";
  if (n >= 1) return "LOW";
  return "INFORMATIONAL";
}

async function destroyAfter<C extends { destroy(): void }, T>(c: C, fn: (c: C) => Promise<T>): Promise<T> {
  try {
    return await fn(c);
  } finally {
    c.destroy();
  }
}

export async function collectSecuritySignals(session: AwsSession, regions: string[]): Promise<SecuritySignals> {
  const home = globalRegionFor(session.partition);
  const iam = createAwsClient(IAMClient, session, home, "iam");
  try {
    const accountSummary = await observe(async () => {
      const m = (await iam.send(new GetAccountSummaryCommand({}))).SummaryMap ?? {};
      if (m.AccountMFAEnabled === undefined || m.AccountAccessKeysPresent === undefined) throw new Error("Incomplete IAM account summary");
      return { rootMfaEnabled: m.AccountMFAEnabled === 1, rootAccessKeysPresent: (m.AccountAccessKeysPresent ?? 0) > 0 };
    });
    const passwordPolicy = await observe(async () => Boolean((await iam.send(new GetAccountPasswordPolicyCommand({}))).PasswordPolicy), { value: false });
    const accessKeys = await observe(async () => {
      const users = await paginate((Marker) => iam.send(new ListUsersCommand({ Marker, MaxItems: 1000 })), (p) => ({ items: p.Users, nextToken: p.IsTruncated ? p.Marker : undefined }), { maxItems: 5000 });
      const settled = await mapSettledLimit(users.filter((u) => u.UserName), 5, async (u) => {
        const keys = await paginate((Marker) => iam.send(new ListAccessKeysCommand({ UserName: u.UserName, Marker })), (p) => ({ items: p.AccessKeyMetadata, nextToken: p.IsTruncated ? p.Marker : undefined }));
        return keys.map((k) => ({
          userName: u.UserName!,
          keyHint: k.AccessKeyId ? `…${k.AccessKeyId.slice(-4)}` : "…",
          ageDays: k.CreateDate ? Math.floor((Date.now() - k.CreateDate.getTime()) / DAY) : 0,
          active: k.Status === "Active",
        }));
      });
      const failed = settled.find((s) => s.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
    });

    const trails = await destroyAfter(createAwsClient(CloudTrailClient, session, home, "cloudtrail"), (ct) =>
      observe(async () => {
        const list = (await ct.send(new DescribeTrailsCommand({ includeShadowTrails: true }))).trailList ?? [];
        return mapSettledLimit(list, 4, async (t) => ({
            name: t.Name ?? "unknown",
            multiRegion: Boolean(t.IsMultiRegionTrail),
            homeRegion: t.HomeRegion ?? null,
            logging: t.TrailARN ? await ct.send(new GetTrailStatusCommand({ Name: t.TrailARN })).then((s) => Boolean(s.IsLogging)).catch(() => null) : null,
          })).then((results) => results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []));
      }),
    );

    const guardDuty: SecuritySignals["guardDuty"] = {};
    const securityHub: SecuritySignals["securityHub"] = {};
    const externalFindings: ExternalFinding[] = [];

    await mapSettledLimit(regions, 4, async (region) => {
      await destroyAfter(createAwsClient(GuardDutyClient, session, region, "guardduty"), async (gd) => {
        const detectors = await observe(async () => paginate((NextToken) => gd.send(new ListDetectorsCommand({ NextToken })), (p) => ({ items: p.DetectorIds, nextToken: p.NextToken })));
        guardDuty[region] = detectors.ok ? { ok: true, value: { enabled: detectors.value.length > 0 } } : detectors;
        if (!detectors.ok || detectors.value.length === 0) return;
        const DetectorId = detectors.value[0]!;
        try {
        const detector = await gd.send(new GetDetectorCommand({ DetectorId }));
        if (detector.Status !== "ENABLED" && detector.Status !== "DISABLED") throw new Error("Unknown detector status");
        guardDuty[region] = { ok: true, value: { enabled: detector.Status === "ENABLED" } };
        if (detector.Status !== "ENABLED") return;
        const ids = await paginate((NextToken) => gd.send(new ListFindingsCommand({ DetectorId, NextToken, MaxResults: 50, FindingCriteria: { Criterion: { "service.archived": { Eq: ["false"] } } } })), (p) => ({ items: p.FindingIds, nextToken: p.NextToken }), { maxItems: 10000 });
        for (let i = 0; i < ids.length; i += 50) {
          const res = await gd.send(new GdGetFindings({ DetectorId, FindingIds: ids.slice(i, i + 50) }));
          if (res.Findings?.length !== ids.slice(i, i + 50).length) throw new Error("Incomplete GuardDuty findings");
          for (const f of res.Findings ?? []) {
            if (!f.Id) continue;
            externalFindings.push({
              source: "GUARDDUTY",
              id: f.Id,
              region,
              title: (f.Title ?? f.Type ?? "GuardDuty finding").slice(0, 300),
              description: (f.Description ?? "").slice(0, 2000),
              severity: guardDutySeverity(f.Severity ?? 0),
              resourceHint: f.Resource?.ResourceType ?? null,
              type: f.Type ?? null,
              updatedAt: f.UpdatedAt ?? null,
              remediation: "Investigate in the GuardDuty console; follow the finding-type remediation guidance.",
            });
          }
        }
        } catch {
          guardDuty[region] = { ok: false, reason: "error" };
        }
      });
      await destroyAfter(createAwsClient(SecurityHubClient, session, region, "securityhub"), async (sh) => {
        try {
          const findings = await paginate(
            (NextToken) => sh.send(new ShGetFindings({
              NextToken, MaxResults: 100,
              Filters: { RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }], WorkflowStatus: [{ Value: "NEW", Comparison: "EQUALS" }, { Value: "NOTIFIED", Comparison: "EQUALS" }] },
            })),
            (p) => ({ items: p.Findings, nextToken: p.NextToken }),
            { maxItems: 10000 },
          );
          securityHub[region] = { ok: true, value: { enabled: true } };
          for (const f of findings) {
            if (!f.Id) continue;
            const label = f.Severity?.Label;
            externalFindings.push({
              source: "SECURITY_HUB",
              id: f.Id,
              region,
              title: (f.Title ?? "Security Hub finding").slice(0, 300),
              description: (f.Description ?? "").slice(0, 2000),
              severity: label === "CRITICAL" || label === "HIGH" || label === "MEDIUM" || label === "LOW" ? label : "INFORMATIONAL",
              resourceHint: f.Resources?.[0]?.Id ?? null,
              type: f.Types?.[0] ?? null,
              updatedAt: f.UpdatedAt ?? null,
              remediation: f.Remediation?.Recommendation?.Text?.slice(0, 1000) ?? null,
            });
          }
        } catch (err) {
          const cls = classifyAwsError(err);
          securityHub[region] = cls === "not_enabled" ? { ok: true, value: { enabled: false } } : { ok: false, reason: cls === "access_denied" ? "access_denied" : "error" };
        }
      });
    });

    return { accountSummary, passwordPolicy, accessKeys, trails, guardDuty, securityHub, externalFindings };
  } finally {
    iam.destroy();
  }
}
