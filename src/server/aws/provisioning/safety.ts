import "server-only";
import { createHash } from "node:crypto";
import type { SecurityGroup } from "@aws-sdk/client-ec2";
import type { Configuration, Guardrails } from "@/lib/provisioning";
import { AppError } from "@/server/errors";
import { isKnownRegion } from "@/server/aws/regions-catalog";
import { describeCidrProblem } from "@/lib/cidr";

export function reject(message: string): never {
  throw new AppError("PRECONDITION_FAILED", message);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function validateGuardrails(
  c: Configuration,
  g: Guardrails,
  enabledRegions: string[],
) {
  if (
    !isKnownRegion(c.region) ||
    !g.allowedRegions.includes(c.region) ||
    !enabledRegions.includes(c.region)
  )
    reject("This region is not enabled and allowed for this connection.");
  if (c.service === "vpc" || c.service === "subnet") {
    // The schema already checked this; it is re-checked here because guardrails are re-evaluated
    // immediately before the mutation, after the plan has been sitting in the database.
    const problem = describeCidrProblem(c.cidr, { min: 16, max: 28 });
    if (problem) reject(problem);
  }
  if (c.service === "ec2") {
    if (!g.allowedInstanceTypes.includes(c.instanceType))
      reject("This instance type is not allowed.");
    if (c.storageGiB > g.maxStorageGiB)
      reject("Storage exceeds the workspace limit.");
    if (c.publicIpv4 && !g.allowPublicIpv4)
      reject("Public IPv4 is disabled by workspace policy.");
    if (
      (c.instanceType.startsWith("t4g.") ? "arm64" : "x86_64") !==
      c.architecture
    )
      reject("Architecture does not match the instance type.");
  }
}
/** Conservative: globally routable ingress may expose only HTTP/HTTPS. IPv6 is checked too. */
export function validateSecurityGroups(
  groups: SecurityGroup[],
  c: Extract<Configuration, { service: "ec2" }>,
  accountId: string,
): boolean {
  if (
    groups.length !== new Set(c.securityGroupIds).size ||
    groups.some(
      (g) =>
        !g.GroupId ||
        !c.securityGroupIds.includes(g.GroupId) ||
        g.VpcId !== c.vpcId ||
        g.OwnerId !== accountId,
    )
  )
    reject("Security groups must belong to the selected VPC and account.");
  let publicIngress = false;
  for (const g of groups)
    for (const p of g.IpPermissions ?? []) {
      if ((p.PrefixListIds ?? []).length)
        reject(
          "Security group prefix lists require separate review and are not supported for provisioning.",
        );
      const publicRange =
        (p.IpRanges ?? []).some((r) => r.CidrIp && !privateIpv4(r.CidrIp)) ||
        (p.Ipv6Ranges ?? []).some(
          (r) => r.CidrIpv6 && !privateIpv6(r.CidrIpv6),
        );
      if (!publicRange) continue;
      publicIngress = true;
      if (
        p.IpProtocol !== "tcp" ||
        p.FromPort !== p.ToPort ||
        ![80, 443].includes(p.FromPort ?? -1)
      )
        reject(
          "Selected security groups expose sensitive or unrestricted ports to public networks. Choose private ingress or HTTP/HTTPS only.",
        );
    }
  if (publicIngress && !c.publicIpv4)
    reject(
      "Choose security groups without public ingress for a private instance.",
    );
  return publicIngress;
}
export function safeAwsError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = error instanceof Error ? error.name : "";
  const messages: Record<string, string> = {
    AccessDenied: "The provisioning role lacks a required permission.",
    AccessDeniedException: "The provisioning role lacks a required permission.",
    UnauthorizedOperation: "The provisioning role lacks a required permission.",
    InvalidAMIID:
      "The selected operating system image is unavailable. Create a new plan.",
    "InvalidAMIID.NotFound":
      "The selected operating system image is unavailable. Create a new plan.",
    InsufficientInstanceCapacity:
      "AWS has insufficient capacity. Try another allowed instance type or region.",
    InstanceLimitExceeded: "The AWS instance quota has been reached.",
    BucketAlreadyExists:
      "That bucket name is already taken. Choose another name.",
    BucketAlreadyOwnedByYou:
      "That bucket already exists. Existing buckets are never adopted or changed by creation.",
    Throttling:
      "AWS is throttling requests. Please wait before planning again.",
    ThrottlingException:
      "AWS is throttling requests. Please wait before planning again.",
    ExpiredToken:
      "The temporary AWS session expired. Revalidate the provisioning connection.",
    InvalidParameterValue:
      "AWS rejected the configuration. Review the selected options.",
  };
  return new AppError(
    "AWS_UNAVAILABLE",
    messages[name] ??
      "AWS could not complete this operation. Check the deployment status before attempting another creation.",
  );
}

function privateIpv4(cidr: string): boolean {
  const [ip, bits] = cidr.split("/"),
    prefix = Number(bits),
    parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    !Number.isInteger(prefix) ||
    prefix > 32
  )
    return false;
  return (
    (parts[0] === 10 && prefix >= 8) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 && prefix >= 12) ||
    (parts[0] === 192 && parts[1] === 168 && prefix >= 16)
  );
}
function privateIpv6(cidr: string): boolean {
  const [ip, bits] = cidr.split("/");
  return (
    /^f[cd][0-9a-f]{2}:/i.test(ip) && Number(bits) >= 7 && Number(bits) <= 128
  );
}
