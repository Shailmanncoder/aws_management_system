import { awsErrorCode, classifyAwsError } from "./errors";

/**
 * Turns an AWS SDK error into an accurate, actionable, user-safe explanation.
 *
 * AWS returns `AccessDeniedException` for several very different situations — a missing IAM
 * permission, an explicit deny, a service control policy, or a service that is simply not
 * enabled for the account. Reporting all of them as "missing permission" sends people to change
 * IAM policies that are already correct, so we match AWS's own wording to classify the cause.
 * The raw AWS message is never echoed to users (it can contain internal ARNs); only the
 * classification, the operation and fixed guidance are surfaced.
 */
export type AwsFailureReason =
  | "service_not_enabled"
  | "permission_denied"
  | "explicit_deny"
  | "scp_denied"
  | "throttled"
  | "unavailable"
  | "invalid_request"
  | "credentials"
  | "unknown";

export interface AwsFailure {
  reason: AwsFailureReason;
  /** IAM action / API operation that failed, e.g. "ce:GetCostAndUsage". */
  action: string;
  errorCode: string;
  /** Short user-facing explanation. */
  message: string;
  /** What the customer should do about it. */
  remediation: string;
}

const msgOf = (err: unknown) => String((err as { message?: unknown } | undefined)?.message ?? "").toLowerCase();

const SERVICE_GUIDANCE: Record<string, { message: string; remediation: string }> = {
  "ce:GetCostAndUsage": {
    message: "Cost Explorer is not enabled for IAM access in this AWS account.",
    remediation:
      "Sign in as the account root user and (1) open Billing and Cost Management → Cost Explorer and enable it, and (2) open Account → IAM user and role access to Billing information → Activate. Cost data can take up to 24 hours to appear after first enabling.",
  },
  "invoicing:ListInvoiceSummaries": {
    message: "The AWS Invoicing API is not available for this account.",
    remediation: "Activate IAM access to billing information (root user → Account settings), or ignore this if you do not need invoice currency totals.",
  },
  "pricing:GetProducts": {
    message: "The AWS Price List API is not available with the current role.",
    remediation: "Add pricing:GetProducts to the Stratus read-only role. Without it, savings estimates are omitted (recommendations still appear).",
  },
};

export function describeAwsFailure(err: unknown, action: string): AwsFailure {
  const errorCode = awsErrorCode(err);
  const m = msgOf(err);
  const service = SERVICE_GUIDANCE[action];
  const base = { action, errorCode };

  // AWS's own wording distinguishes these cases; match it rather than assuming "missing permission".
  if (/not enabled for cost explorer|not subscribed|is not signed up|not authorized to use this service|service is not enabled|not opted in/.test(m)) {
    return {
      ...base,
      reason: "service_not_enabled",
      message: service?.message ?? `The AWS service behind ${action} is not enabled for this account.`,
      remediation: service?.remediation ?? "Enable the service in the AWS console for this account, then re-run the sync.",
    };
  }
  if (/service control polic|\bscp\b/.test(m)) {
    return {
      ...base,
      reason: "scp_denied",
      message: `An AWS Organizations service control policy blocks ${action}.`,
      remediation: "Ask the management account to allow this action for this member account, or accept that the related data will be unavailable.",
    };
  }
  if (/explicit deny/.test(m)) {
    return {
      ...base,
      reason: "explicit_deny",
      message: `${action} is explicitly denied by a policy attached to the role.`,
      remediation: "Review deny statements on the Stratus role and its permissions boundary (the Stratus deny policy covers data-plane reads only).",
    };
  }
  const cls = classifyAwsError(err);
  if (cls === "access_denied") {
    return {
      ...base,
      reason: "permission_denied",
      message: `Missing required AWS permission: ${action}`,
      remediation: "Update the Stratus read-only role with the policy from Settings → Cloud accounts → the connection wizard, then re-validate.",
    };
  }
  if (cls === "not_enabled") {
    return {
      ...base,
      reason: "service_not_enabled",
      message: service?.message ?? `The AWS service behind ${action} is not enabled for this account.`,
      remediation: service?.remediation ?? "Enable the service in the AWS console, then re-run the sync.",
    };
  }
  if (cls === "throttled") {
    return { ...base, reason: "throttled", message: `AWS throttled ${action}.`, remediation: "Stratus retries automatically; re-run the sync if the problem persists." };
  }
  if (cls === "invalid_credentials" || cls === "expired") {
    return { ...base, reason: "credentials", message: "The AWS role session is no longer valid.", remediation: "Re-validate the connection in Settings → Cloud accounts." };
  }
  if (cls === "validation") {
    return { ...base, reason: "invalid_request", message: `AWS rejected the ${action} request as invalid.`, remediation: "This is likely a Stratus bug — please report it with the request ID." };
  }
  return {
    ...base,
    reason: cls === "service_unavailable" ? "unavailable" : "unknown",
    message: `${action} failed (${errorCode}).`,
    remediation: "Retry later. If it persists, check the AWS service health dashboard and the connection diagnostics.",
  };
}

/** One-line summary for job error fields: what failed, why, and what to do. */
export function failureSummary(f: AwsFailure): string {
  return `${f.message} (${f.action}, ${f.errorCode}) — ${f.remediation}`;
}
