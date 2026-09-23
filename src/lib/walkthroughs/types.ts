import type { ConsoleTarget } from "./console";

/**
 * Guided walkthroughs: click-by-click instructions for doing something in the AWS console.
 *
 * These are pure data. Steps may contain `{{token}}` placeholders which are resolved against the
 * workspace's real inventory before rendering (see `resolveTokens`), so a walkthrough shows the
 * reader their own VPC and subnet ids rather than made-up examples. A token that cannot be
 * resolved is replaced with a visible hint, never with a plausible-looking fake value.
 */

export type WalkthroughCategory = "launch" | "remediate" | "storage" | "network";

export const CATEGORY_LABELS: Record<WalkthroughCategory, string> = {
  launch: "Launch compute",
  remediate: "Fix a finding",
  storage: "Storage and databases",
  network: "Networking basics",
};

export interface WalkthroughField {
  label: string;
  /** What to type or pick. May contain tokens. */
  value: string;
  /** Why this value — so the reader can deviate knowingly rather than blindly. */
  why: string;
}

export interface WalkthroughStep {
  title: string;
  /** Where it lives, as a breadcrumb: ["Console", "EC2", "Instances"]. */
  where?: string[];
  /** Console deep link for this step. */
  target?: ConsoleTarget;
  /** Ordered instructions. May contain tokens. */
  actions: string[];
  /** Exact values to enter on this screen. */
  fields?: WalkthroughField[];
  note?: string;
  /** Shown prominently: money, downtime or exposure consequences. */
  warning?: string;
}

export interface Walkthrough {
  id: string;
  title: string;
  category: WalkthroughCategory;
  /** One sentence: what you will have when you finish. */
  summary: string;
  estimatedMinutes: number;
  /** Security finding rule ids this walkthrough remediates. */
  fixesRuleIds?: string[];
  prerequisites?: string[];
  steps: WalkthroughStep[];
  /** Equivalent CLI, for people who would rather not click. */
  cli?: { description: string; commands: string[] };
  /** What it will cost, stated honestly. */
  cost?: string;
  /** How to verify it worked, and how to undo it. */
  verify?: string[];
  rollback?: string;
  /** Relevant AWS documentation (aws.amazon.com only). */
  docs?: { label: string; url: string }[];
}

/** Values pulled from the reader's own inventory. */
export interface WalkthroughContext {
  region?: string;
  accountId?: string;
  vpcId?: string;
  subnetId?: string;
  publicSubnetId?: string;
  securityGroupId?: string;
  bucketName?: string;
  instanceId?: string;
  /** The specific resource a remediation walkthrough was opened for. */
  resourceId?: string;
}

const TOKEN_HINTS: Record<keyof WalkthroughContext, string> = {
  region: "your region",
  accountId: "your 12-digit account id",
  vpcId: "your VPC id (none found — step 1 creates one)",
  subnetId: "your subnet id (none found — create a subnet first)",
  publicSubnetId: "a public subnet id (none found — see the VPC walkthrough)",
  securityGroupId: "your security group id (none found — create one first)",
  bucketName: "your bucket name",
  instanceId: "your instance id",
  resourceId: "the affected resource",
};

const TOKEN_RE = /\{\{([a-zA-Z]+)\}\}/g;

/** Replaces `{{token}}` with a real value, or with a bracketed hint when we do not have one. */
export function resolveTokens(text: string, ctx: WalkthroughContext): string {
  return text.replace(TOKEN_RE, (whole, rawKey: string) => {
    const key = rawKey as keyof WalkthroughContext;
    if (!Object.hasOwn(TOKEN_HINTS, key)) return whole;
    const value = ctx[key];
    return value ? value : `[${TOKEN_HINTS[key]}]`;
  });
}

/** True when the text still depends on a value we could not resolve. */
export function hasUnresolvedTokens(text: string, ctx: WalkthroughContext): boolean {
  TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const key = m[1] as keyof WalkthroughContext;
    if (Object.hasOwn(TOKEN_HINTS, key) && !ctx[key]) return true;
  }
  return false;
}
