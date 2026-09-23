/**
 * IPv4 CIDR arithmetic for network provisioning.
 *
 * Pure and dependency-free so both the browser form and the server validator use identical rules —
 * the server is still the authority, but a mismatch would only ever show as a confusing error.
 *
 * All arithmetic is done on unsigned 32-bit integers via `>>> 0`, because a left shift in
 * JavaScript produces a signed result and `1 << 31` is negative.
 */

export interface Ipv4Cidr {
  /** Network address as an unsigned 32-bit integer. */
  base: number;
  /** Prefix length, 0-32. */
  prefix: number;
}

/** Parses "10.0.0.0/16". Returns null for anything malformed, including a non-canonical network. */
export function parseCidr(value: string): Ipv4Cidr | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  // Reject leading zeros ("010.0.0.1"), which parse inconsistently across tools.
  if ([match[1], match[2], match[3], match[4]].some((o) => o!.length > 1 && o!.startsWith("0"))) return null;
  const prefix = Number(match[5]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const address = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  // `&` yields a SIGNED 32-bit result, so this must be coerced back to unsigned before comparing:
  // without it every address at or above 128.0.0.0 (including 172.16.0.0/12) compares as negative.
  const base = (maskOf(prefix) & address) >>> 0;
  // The address must be the network address: 10.0.0.1/16 is a host, not a network.
  if (base !== address) return null;
  return { base, prefix };
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function formatCidr(c: Ipv4Cidr): string {
  const b = c.base >>> 0;
  return `${(b >>> 24) & 255}.${(b >>> 16) & 255}.${(b >>> 8) & 255}.${b & 255}/${c.prefix}`;
}

/** Last address in the block, as an unsigned 32-bit integer. */
export function lastAddress(c: Ipv4Cidr): number {
  return (c.base | (~maskOf(c.prefix) >>> 0)) >>> 0;
}

/** Total addresses in the block, including network and broadcast. */
export function addressCount(c: Ipv4Cidr): number {
  return 2 ** (32 - c.prefix);
}

/**
 * Addresses AWS actually leaves usable in a subnet: it reserves five per subnet (network,
 * VPC router, DNS, future use, broadcast).
 */
export function usableSubnetAddresses(c: Ipv4Cidr): number {
  return Math.max(0, addressCount(c) - 5);
}

/** True when `inner` is entirely inside `outer` (a block contains itself). */
export function contains(outer: Ipv4Cidr, inner: Ipv4Cidr): boolean {
  if (inner.prefix < outer.prefix) return false;
  return ((inner.base & maskOf(outer.prefix)) >>> 0) === outer.base;
}

/** True when two blocks share any address. */
export function overlaps(a: Ipv4Cidr, b: Ipv4Cidr): boolean {
  return contains(a, b) || contains(b, a);
}

/**
 * RFC 1918 private ranges. Public address space is refused for VPCs and subnets: AWS permits it,
 * but routing address space you do not own is a way to make traffic to the real owner of that
 * space disappear into your VPC.
 */
const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((r) => parseCidr(r)!);

export function isPrivate(c: Ipv4Cidr): boolean {
  return PRIVATE_RANGES.some((range) => contains(range, c));
}

/**
 * Explains why a CIDR is unacceptable, or returns null when it is fine.
 * `min`/`max` bound the prefix length: AWS allows /16-/28 for both VPCs and subnets.
 */
export function describeCidrProblem(value: string, { min, max }: { min: number; max: number }): string | null {
  const parsed = parseCidr(value);
  if (!parsed) return "Enter a network in CIDR form, for example 10.0.0.0/16. The address must be the start of the block.";
  if (parsed.prefix < min) return `The block is too large. Use a prefix between /${min} and /${max}.`;
  if (parsed.prefix > max) return `The block is too small. Use a prefix between /${min} and /${max}.`;
  if (!isPrivate(parsed)) return "Use a private range: 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16. Public address space you do not own must not be routed inside a VPC.";
  return null;
}
