/**
 * Strict IAM role ARN parsing. User-supplied ARNs are untrusted: only the role resource type,
 * known partitions and AWS's documented name charset are accepted.
 */

export const PARTITIONS = ["aws", "aws-us-gov", "aws-cn"] as const;
export type Partition = (typeof PARTITIONS)[number];

export interface ParsedRoleArn {
  arn: string;
  partition: Partition;
  accountId: string;
  /** Path including leading and trailing "/" (e.g. "/" or "/stratus/"). */
  path: string;
  roleName: string;
}

// arn:<partition>:iam::<12 digits>:role/<optional path segments/><role name>
const ROLE_ARN_RE =
  /^arn:(aws|aws-us-gov|aws-cn):iam::(\d{12}):role\/((?:[\w+=,.@-]{1,64}\/){0,20})([\w+=,.@-]{1,64})$/;

export function parseRoleArn(input: unknown): ParsedRoleArn | null {
  if (typeof input !== "string") return null;
  const arn = input.trim();
  if (arn.length > 2048) return null;
  const m = ROLE_ARN_RE.exec(arn);
  if (!m) return null;
  const [, partition, accountId, pathPart, roleName] = m as unknown as [string, Partition, string, string, string];
  // Conservative: reject dot-only segments ("." / "..") even though IAM's charset permits dots.
  if ([...pathPart.split("/"), roleName].some((seg) => /^\.+$/.test(seg))) return null;
  return { arn, partition, accountId, path: `/${pathPart}`, roleName };
}

/** Extracts the account id from any IAM/STS principal ARN (used for GetCallerIdentity checks). */
export function accountIdFromArn(arn: string): string | null {
  const m = /^arn:aws(?:-[a-z]+)*:(?:iam|sts)::(\d{12}):/.exec(arn);
  return m ? m[1]! : null;
}

/** True when the ARN identifies an account root principal. */
export function isRootPrincipalArn(arn: string): boolean {
  return /^arn:aws(?:-[a-z]+)*:iam::\d{12}:root$/.test(arn);
}
