/**
 * Security rule engine — pure functions over normalised inventory + account signals.
 * Every draft explains WHAT (description), WHY (rationale), EVIDENCE and HOW (remediation).
 * Evidence contains configuration facts only — never secrets or key material.
 */
import { describePorts, isWorldOpen, ruleCoversPort, SENSITIVE_PORTS } from "@/lib/network";
import type {
  DynamoTableAttrs,
  EbsSnapshotAttrs,
  EbsVolumeAttrs,
  EcrRepositoryAttrs,
  EksClusterAttrs,
  LambdaAttrs,
  RdsClusterAttrs,
  RdsInstanceAttrs,
  S3BucketAttrs,
  SecurityGroupAttrs,
} from "@/lib/resource-types";
import { assessBucketExposure } from "@/lib/s3-posture";
import type { SecuritySignals } from "../aws/security-signals";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

export interface RuleResource {
  id: string;
  resourceType: string;
  region: string;
  resourceId: string;
  name: string | null;
  attributes: unknown;
}

export interface FindingDraft {
  ruleId: string;
  /** Stable key within the account (resource id or account-level key). */
  subjectKey: string;
  resourceRefId: string | null;
  severity: Severity;
  title: string;
  description: string;
  rationale: string;
  evidence: Record<string, unknown>;
  remediation: string;
  region: string;
}

export interface SecurityRule {
  id: string;
  title: string;
  resourceType?: string;
  evaluate(r: RuleResource): FindingDraft[];
}

const label = (r: RuleResource) => r.name && r.name !== r.resourceId ? `${r.name} (${r.resourceId})` : r.resourceId;
const draft = (r: RuleResource, d: Omit<FindingDraft, "subjectKey" | "resourceRefId" | "region">): FindingDraft => ({ ...d, subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}`, resourceRefId: r.id, region: r.region });

const DB_PORTS = new Set([3306, 5432, 1433, 1521, 27017, 6379, 9200, 11211, 5601]);
export const DEPRECATED_RUNTIME = /^(python3\.[6-8]|python2\.7|nodejs(4\.3|6\.10|8\.10|10\.x|12\.x|14\.x|16\.x)|dotnetcore[12]\.|dotnet5\.0|ruby2\.[57]|go1\.x|java8$)/;

export const RESOURCE_RULES: SecurityRule[] = [
  {
    id: "S3-PUBLIC",
    title: "S3 bucket publicly accessible",
    resourceType: "s3:bucket",
    evaluate(r) {
      const a = r.attributes as S3BucketAttrs;
      const e = assessBucketExposure(a);
      if (e.level === "public") {
        return [
          draft(r, {
            ruleId: "S3-PUBLIC",
            severity: "CRITICAL",
            title: `S3 bucket ${r.resourceId} is publicly accessible`,
            description: e.reasons.join(" "),
            rationale: "Anyone on the internet may be able to list or read objects, leading to data exposure. Two independent signals (a public grant and no effective Block Public Access) were confirmed.",
            evidence: Object.fromEntries(e.signals.map((s) => [s.label, s.value])),
            remediation: "If the bucket is not intentionally public, enable all four Block Public Access settings (bucket or account level) and remove public statements/ACL grants. For static websites prefer CloudFront with Origin Access Control.",
          }),
        ];
      }
      if (e.level === "not-blocked") {
        return [
          draft(r, {
            ruleId: "S3-BPA-OFF",
            severity: "MEDIUM",
            title: `Block Public Access not fully enabled on ${r.resourceId}`,
            description: e.reasons.join(" "),
            rationale: "Without Block Public Access, a single policy or ACL change can expose the bucket.",
            evidence: Object.fromEntries(e.signals.map((s) => [s.label, s.value])),
            remediation: "Enable all four Block Public Access settings on the bucket, or at the account level if no bucket needs public access.",
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "S3-VERSIONING",
    title: "S3 versioning disabled",
    resourceType: "s3:bucket",
    evaluate(r) {
      const a = r.attributes as S3BucketAttrs;
      if (!a.versioning.ok || a.versioning.value === "Enabled") return [];
      return [draft(r, { ruleId: "S3-VERSIONING", severity: "LOW", title: `Versioning is ${a.versioning.value.toLowerCase()} on ${r.resourceId}`, description: `Bucket versioning status: ${a.versioning.value}.`, rationale: "Without versioning, overwritten or deleted objects (including by ransomware or mistakes) cannot be recovered.", evidence: { versioning: a.versioning.value }, remediation: "Enable versioning and add lifecycle rules to expire noncurrent versions." })];
    },
  },
  {
    id: "S3-LOGGING",
    title: "S3 access logging disabled",
    resourceType: "s3:bucket",
    evaluate(r) {
      const a = r.attributes as S3BucketAttrs;
      if (!a.logging.ok || a.logging.value.enabled) return [];
      return [draft(r, { ruleId: "S3-LOGGING", severity: "LOW", title: `Server access logging disabled on ${r.resourceId}`, description: "No server access logging target is configured.", rationale: "Access logs support incident investigation and detection of unexpected access.", evidence: { logging: "disabled" }, remediation: "Enable server access logging to a dedicated log bucket, or use CloudTrail data events." })];
    },
  },
  {
    id: "SG-OPEN",
    title: "Security group allows internet access to sensitive ports",
    resourceType: "ec2:security-group",
    evaluate(r) {
      const a = r.attributes as SecurityGroupAttrs;
      const out: FindingDraft[] = [];
      for (const rule of a.ingress.filter(isWorldOpen)) {
        const sources = rule.sources.filter((s) => s.value === "0.0.0.0/0" || s.value === "::/0").map((s) => s.value);
        const sensitive = Object.entries(SENSITIVE_PORTS).filter(([p]) => ruleCoversPort(rule, Number(p)));
        const allTraffic = rule.protocol === "-1";
        const db = sensitive.some(([p]) => DB_PORTS.has(Number(p)));
        if (sensitive.length === 0) {
          const common = rule.protocol === "tcp" && rule.fromPort !== null && rule.toPort === rule.fromPort && (rule.fromPort === 80 || rule.fromPort === 443);
          if (common) continue;
          out.push({ ...draft(r, { ruleId: "SG-WIDE", severity: "MEDIUM", title: `${label(r)} allows ${describePorts(rule)} from the internet`, description: `Inbound rule ${describePorts(rule)} is open to ${sources.join(", ")}.`, rationale: "Broad internet ingress increases attack surface; only intentionally public service ports should be open.", evidence: { rule: describePorts(rule), sources, vpcId: a.vpcId }, remediation: "Restrict the source to known CIDRs or security groups, or place the service behind a load balancer." }), subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|${describePorts(rule)}` });
          continue;
        }
        const names = sensitive.map(([p, n]) => `${n} (${p})`);
        out.push({
          ...draft(r, {
            ruleId: "SG-OPEN",
            severity: allTraffic || db ? "CRITICAL" : "HIGH",
            title: allTraffic ? `${label(r)} allows ALL traffic from the internet` : `${label(r)} exposes ${sensitive.map(([, n]) => n).join(", ")} to the internet`,
            description: `Inbound rule ${describePorts(rule)} from ${sources.join(", ")} covers sensitive port(s): ${names.join(", ")}.`,
            rationale: allTraffic ? "The security group permits every port from the internet. Actual reachability also depends on routes, addresses, and network ACLs." : db ? "Databases exposed to the internet are routinely scanned and brute-forced." : "Remote administration ports exposed to the internet are a common initial-access vector.",
            evidence: { rule: describePorts(rule), sources, sensitivePorts: names, vpcId: a.vpcId },
            remediation: db ? "Remove the internet source; allow only application security groups. Keep databases in private subnets." : "Remove 0.0.0.0/0 / ::/0; use AWS Systems Manager Session Manager or a VPN / known CIDRs for administration.",
          }),
          subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|${describePorts(rule)}`,
        });
      }
      return out;
    },
  },
  {
    id: "EBS-UNENCRYPTED",
    title: "Unencrypted EBS volume",
    resourceType: "ec2:volume",
    evaluate(r) {
      const a = r.attributes as EbsVolumeAttrs;
      if (a.encrypted) return [];
      return [draft(r, { ruleId: "EBS-UNENCRYPTED", severity: "MEDIUM", title: `EBS volume ${label(r)} is not encrypted`, description: `${a.sizeGiB} GiB ${a.volumeType ?? ""} volume without encryption.`, rationale: "Unencrypted volumes and their snapshots expose data at rest if copied or shared.", evidence: { encrypted: false, sizeGiB: a.sizeGiB, attachedTo: a.attachedInstanceIds }, remediation: "Snapshot, copy the snapshot with encryption, create a new encrypted volume and swap it in. Enable EBS encryption by default for the region." })];
    },
  },
  {
    id: "SNAPSHOT-UNENCRYPTED",
    title: "Unencrypted EBS snapshot",
    resourceType: "ec2:snapshot",
    evaluate(r) {
      const a = r.attributes as EbsSnapshotAttrs;
      if (a.encrypted) return [];
      return [draft(r, { ruleId: "SNAPSHOT-UNENCRYPTED", severity: "LOW", title: `EBS snapshot ${r.resourceId} is not encrypted`, description: "Snapshot data is stored without encryption.", rationale: "Unencrypted snapshots can be shared or copied without key controls.", evidence: { encrypted: false, volumeId: a.volumeId }, remediation: "Copy the snapshot with encryption enabled and delete the unencrypted copy." })];
    },
  },
  {
    id: "RDS-PUBLIC",
    title: "RDS instance publicly accessible",
    resourceType: "rds:db-instance",
    evaluate(r) {
      const a = r.attributes as RdsInstanceAttrs;
      const out: FindingDraft[] = [];
      if (a.publiclyAccessible) out.push(draft(r, { ruleId: "RDS-PUBLIC", severity: "HIGH", title: `RDS instance ${r.resourceId} is publicly accessible`, description: "PubliclyAccessible=true: the endpoint resolves to a public IP.", rationale: "Combined with permissive security groups, the database becomes reachable from the internet.", evidence: { publiclyAccessible: true, engine: a.engine, subnets: a.subnetIds, securityGroups: a.securityGroupIds }, remediation: "Modify the instance to disable public accessibility and place it in private subnets." }));
      if (!a.encrypted) out.push({ ...draft(r, { ruleId: "RDS-UNENCRYPTED", severity: "HIGH", title: `RDS instance ${r.resourceId} storage is not encrypted`, description: "StorageEncrypted=false.", rationale: "Data, automated backups and snapshots are unencrypted at rest.", evidence: { storageEncrypted: false, engine: a.engine }, remediation: "Create an encrypted snapshot copy and restore to a new encrypted instance." }), subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|enc` });
      if (a.backupRetentionDays === 0) out.push({ ...draft(r, { ruleId: "RDS-NO-BACKUP", severity: "MEDIUM", title: `Automated backups disabled for ${r.resourceId}`, description: "BackupRetentionPeriod=0.", rationale: "Without automated backups there is no point-in-time recovery after corruption or deletion.", evidence: { backupRetentionPeriod: 0 }, remediation: "Set a backup retention period (e.g. 7–35 days)." }), subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|backup` });
      return out;
    },
  },
  {
    id: "RDS-CLUSTER-UNENCRYPTED",
    title: "Aurora cluster storage not encrypted",
    resourceType: "rds:db-cluster",
    evaluate(r) {
      const a = r.attributes as RdsClusterAttrs;
      if (a.encrypted) return [];
      return [draft(r, { ruleId: "RDS-CLUSTER-UNENCRYPTED", severity: "HIGH", title: `Aurora cluster ${r.resourceId} is not encrypted`, description: "StorageEncrypted=false.", rationale: "Cluster volumes and snapshots are unencrypted at rest.", evidence: { storageEncrypted: false }, remediation: "Restore from an encrypted snapshot copy into a new encrypted cluster." })];
    },
  },
  {
    id: "DDB-PITR",
    title: "DynamoDB point-in-time recovery disabled",
    resourceType: "dynamodb:table",
    evaluate(r) {
      const a = r.attributes as DynamoTableAttrs;
      if (!a.pointInTimeRecovery.ok || a.pointInTimeRecovery.value) return [];
      return [draft(r, { ruleId: "DDB-PITR", severity: "LOW", title: `Point-in-time recovery disabled on ${r.resourceId}`, description: "PITR status: DISABLED.", rationale: "Accidental writes or deletes cannot be rolled back to a point in time.", evidence: { pointInTimeRecovery: "DISABLED" }, remediation: "Enable point-in-time recovery for the table." })];
    },
  },
  {
    id: "EKS-PUBLIC-ENDPOINT",
    title: "EKS API endpoint open to the internet",
    resourceType: "eks:cluster",
    evaluate(r) {
      const a = r.attributes as EksClusterAttrs;
      if (!a.endpointPublicAccess || !a.publicAccessCidrs.some((c) => c === "0.0.0.0/0")) return [];
      return [draft(r, { ruleId: "EKS-PUBLIC-ENDPOINT", severity: "HIGH", title: `EKS cluster ${r.resourceId} API endpoint is open to 0.0.0.0/0`, description: "Public endpoint access is enabled for all source addresses.", rationale: "The Kubernetes API is reachable from anywhere; exploits or leaked credentials can be used directly.", evidence: { endpointPublicAccess: true, publicAccessCidrs: a.publicAccessCidrs, endpointPrivateAccess: a.endpointPrivateAccess }, remediation: "Restrict publicAccessCidrs to known networks or disable public access and use the private endpoint." })];
    },
  },
  {
    id: "ECR-SCAN",
    title: "ECR image scanning",
    resourceType: "ecr:repository",
    evaluate(r) {
      const a = r.attributes as EcrRepositoryAttrs;
      const out: FindingDraft[] = [];
      if (!a.scanOnPush) out.push(draft(r, { ruleId: "ECR-SCAN-OFF", severity: "LOW", title: `Scan on push disabled for ${r.resourceId}`, description: "Repository-level scan on push is disabled. Registry-level enhanced scanning was not evaluated.", rationale: "Without another scanning configuration, known vulnerabilities in new images may go unnoticed.", evidence: { scanOnPush: false }, remediation: "Enable scan on push or Amazon Inspector enhanced scanning." }));
      if (a.latestScan && a.latestScan.critical > 0) out.push({ ...draft(r, { ruleId: "ECR-CRITICAL-VULNS", severity: "HIGH", title: `Latest image in ${r.resourceId} has ${a.latestScan.critical} critical vulnerabilities`, description: `Most recent scan: ${a.latestScan.critical} critical, ${a.latestScan.high} high.`, rationale: "Critical CVEs in deployed images are frequently exploitable.", evidence: { latestScan: a.latestScan }, remediation: "Rebuild the image on patched base layers and redeploy." }), subjectKey: `${r.resourceType}|${r.region}|${r.resourceId}|vulns` });
      return out;
    },
  },
  {
    id: "LAMBDA-DEPRECATED-RUNTIME",
    title: "Lambda uses a deprecated runtime",
    resourceType: "lambda:function",
    evaluate(r) {
      const a = r.attributes as LambdaAttrs;
      if (!a.runtime || !DEPRECATED_RUNTIME.test(a.runtime)) return [];
      return [draft(r, { ruleId: "LAMBDA-DEPRECATED-RUNTIME", severity: "MEDIUM", title: `Lambda ${r.resourceId} uses deprecated runtime ${a.runtime}`, description: `Runtime ${a.runtime} no longer receives security patches from AWS.`, rationale: "Deprecated runtimes accumulate unpatched vulnerabilities and will eventually be blocked from updates.", evidence: { runtime: a.runtime }, remediation: "Upgrade to a supported runtime version and test the function." })];
    },
  },
  {
    id: "SQS-UNENCRYPTED",
    title: "SQS queue without encryption",
    resourceType: "sqs:queue",
    evaluate(r) {
      const enc = (r.attributes as { encryption?: string }).encryption;
      if (enc !== "none") return [];
      return [draft(r, { ruleId: "SQS-UNENCRYPTED", severity: "LOW", title: `SQS queue ${r.resourceId} is not encrypted`, description: "Neither SSE-SQS nor SSE-KMS is enabled.", rationale: "Messages may contain sensitive data at rest.", evidence: { encryption: "none" }, remediation: "Enable SSE-SQS or SSE-KMS on the queue." })];
    },
  },
];

/** Account-level rules from security signals. `ranChecks` lists rule ids that actually ran. */
export function evaluateAccountSignals(s: SecuritySignals, homeRegion: string): { drafts: FindingDraft[]; ranChecks: string[] } {
  const drafts: FindingDraft[] = [];
  const ran: string[] = [];
  const acct = (ruleId: string, key: string, d: Omit<FindingDraft, "ruleId" | "subjectKey" | "resourceRefId" | "region"> & { region?: string }) =>
    drafts.push({ ruleId, subjectKey: `account|${key}`, resourceRefId: null, region: d.region ?? homeRegion, ...d });

  if (s.accountSummary.ok) {
    ran.push("IAM-ROOT-MFA", "IAM-ROOT-KEYS");
    if (!s.accountSummary.value.rootMfaEnabled) acct("IAM-ROOT-MFA", "root-mfa", { severity: "CRITICAL", title: "Root account MFA is not enabled", description: "AccountMFAEnabled=0 in the IAM account summary.", rationale: "The root user has unrestricted access; a password compromise gives full account control.", evidence: { AccountMFAEnabled: 0 }, remediation: "Sign in as root and enable a hardware or virtual MFA device; store recovery securely." });
    if (s.accountSummary.value.rootAccessKeysPresent) acct("IAM-ROOT-KEYS", "root-keys", { severity: "CRITICAL", title: "Root account has access keys", description: "AccountAccessKeysPresent>0.", rationale: "Root access keys grant unrestricted programmatic access and cannot be scoped.", evidence: { AccountAccessKeysPresent: true }, remediation: "Delete root access keys; use IAM roles for automation." });
  }
  if (s.passwordPolicy.ok) {
    ran.push("IAM-PASSWORD-POLICY");
    if (!s.passwordPolicy.value) acct("IAM-PASSWORD-POLICY", "password-policy", { severity: "MEDIUM", title: "No IAM account password policy", description: "GetAccountPasswordPolicy returned no policy.", rationale: "IAM users may set weak passwords.", evidence: { passwordPolicy: "none" }, remediation: "Configure an account password policy (length ≥ 14, prevent reuse), or use IAM Identity Center." });
  }
  if (s.accessKeys.ok) {
    ran.push("IAM-OLD-ACCESS-KEY");
    for (const k of s.accessKeys.value.filter((k) => k.active && k.ageDays > 90)) {
      acct("IAM-OLD-ACCESS-KEY", `key|${k.userName}|${k.keyHint}`, { severity: k.ageDays > 365 ? "HIGH" : "MEDIUM", title: `Access key ${k.keyHint} for IAM user ${k.userName} is ${k.ageDays} days old`, description: `Active access key created ${k.ageDays} days ago.`, rationale: "Long-lived keys are more likely to have leaked (repos, laptops, CI logs).", evidence: { userName: k.userName, key: k.keyHint, ageDays: k.ageDays, status: "Active" }, remediation: "Rotate the key (create new, update consumers, deactivate, delete old) or replace with IAM roles." });
    }
  }
  if (s.trails.ok && !s.trails.value.some((t) => t.logging === null)) {
    ran.push("CLOUDTRAIL");
    const good = s.trails.value.some((t) => t.multiRegion && t.logging === true);
    if (!good) acct("CLOUDTRAIL", "cloudtrail", { severity: "HIGH", title: "No active multi-region CloudTrail trail", description: s.trails.value.length ? "Trails exist but none is multi-region and logging." : "No CloudTrail trails are configured.", rationale: "Without an audit trail, investigating unauthorized API activity is not possible.", evidence: { trails: s.trails.value.map((t) => ({ name: t.name, multiRegion: t.multiRegion, logging: t.logging })) }, remediation: "Create a multi-region trail (or an organization trail) with log file validation enabled." });
  }
  for (const [region, gd] of Object.entries(s.guardDuty)) {
    if (!gd.ok) continue;
    ran.push(`GUARDDUTY-DISABLED|${region}`);
    if (!gd.value.enabled) acct("GUARDDUTY-DISABLED", `guardduty|${region}`, { region, severity: "MEDIUM", title: `GuardDuty is not enabled in ${region}`, description: "No enabled GuardDuty detector was found in this region.", rationale: "Threat detection for this region (e.g. crypto-mining, credential exfiltration) is missing.", evidence: { region, detector: "missing or disabled" }, remediation: "Enable GuardDuty in all enabled regions (ideally via AWS Organizations delegated admin)." });
  }
  return { drafts, ranChecks: ran };
}
