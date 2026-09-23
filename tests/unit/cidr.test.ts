import { describe, expect, it } from "vitest";
import { addressCount, contains, describeCidrProblem, formatCidr, isPrivate, lastAddress, overlaps, parseCidr, usableSubnetAddresses } from "@/lib/cidr";

const cidr = (s: string) => {
  const parsed = parseCidr(s);
  if (!parsed) throw new Error(`expected ${s} to parse`);
  return parsed;
};

describe("parseCidr", () => {
  it("parses valid networks and round-trips them", () => {
    for (const value of ["10.0.0.0/16", "172.16.0.0/12", "192.168.1.0/24", "0.0.0.0/0", "10.255.255.255/32"]) {
      expect(formatCidr(cidr(value))).toBe(value);
    }
  });

  it("handles the high bit without sign errors", () => {
    // 128.0.0.0 sets bit 31; a signed shift would make this negative and break every comparison.
    expect(formatCidr(cidr("128.0.0.0/1"))).toBe("128.0.0.0/1");
    expect(cidr("255.255.255.255/32").base).toBeGreaterThan(0);
    expect(lastAddress(cidr("128.0.0.0/1"))).toBe(4294967295);
  });

  it("rejects host addresses that are not the start of their block", () => {
    expect(parseCidr("10.0.0.1/16")).toBeNull();
    expect(parseCidr("192.168.1.5/24")).toBeNull();
    expect(parseCidr("10.0.0.0/16")).not.toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "10.0.0.0", "10.0.0.0/", "10.0.0.0/33", "10.0.0.0/-1", "256.0.0.0/8", "10.0.0/8", "10.0.0.0.0/8", "ten.0.0.0/8", "10.0.0.0/8extra", "::/0"]) {
      expect(parseCidr(bad), bad).toBeNull();
    }
  });

  it("rejects leading zeros, which different tools parse differently", () => {
    expect(parseCidr("010.0.0.0/8")).toBeNull();
    expect(parseCidr("10.00.0.0/8")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(formatCidr(cidr("  10.0.0.0/8  "))).toBe("10.0.0.0/8");
  });
});

describe("containment and overlap", () => {
  it("knows when one block sits inside another", () => {
    expect(contains(cidr("10.0.0.0/16"), cidr("10.0.1.0/24"))).toBe(true);
    expect(contains(cidr("10.0.0.0/16"), cidr("10.1.0.0/24"))).toBe(false);
    expect(contains(cidr("10.0.0.0/16"), cidr("10.0.0.0/16"))).toBe(true);
    // A larger block is never contained in a smaller one.
    expect(contains(cidr("10.0.1.0/24"), cidr("10.0.0.0/16"))).toBe(false);
  });

  it("detects overlap in both directions", () => {
    expect(overlaps(cidr("10.0.0.0/16"), cidr("10.0.5.0/24"))).toBe(true);
    expect(overlaps(cidr("10.0.5.0/24"), cidr("10.0.0.0/16"))).toBe(true);
    expect(overlaps(cidr("10.0.0.0/24"), cidr("10.0.1.0/24"))).toBe(false);
    expect(overlaps(cidr("10.0.0.0/8"), cidr("172.16.0.0/12"))).toBe(false);
  });

  it("treats adjacent blocks as non-overlapping", () => {
    expect(overlaps(cidr("10.0.0.0/25"), cidr("10.0.0.128/25"))).toBe(false);
  });
});

describe("sizes", () => {
  it("counts addresses, and what AWS actually leaves usable", () => {
    expect(addressCount(cidr("10.0.0.0/24"))).toBe(256);
    expect(usableSubnetAddresses(cidr("10.0.0.0/24"))).toBe(251);
    expect(usableSubnetAddresses(cidr("10.0.0.0/28"))).toBe(11);
    expect(addressCount(cidr("10.0.0.0/16"))).toBe(65536);
  });

  it("never reports a negative usable count", () => {
    expect(usableSubnetAddresses(cidr("10.0.0.0/32"))).toBe(0);
    expect(usableSubnetAddresses(cidr("10.0.0.0/30"))).toBe(0);
  });
});

describe("private address space", () => {
  it("accepts the three RFC 1918 ranges", () => {
    for (const value of ["10.0.0.0/8", "10.200.0.0/16", "172.16.0.0/12", "172.31.0.0/16", "192.168.0.0/16", "192.168.5.0/24"]) {
      expect(isPrivate(cidr(value)), value).toBe(true);
    }
  });

  it("rejects public space and the near-misses around 172.16/12", () => {
    for (const value of ["8.8.8.0/24", "172.15.0.0/16", "172.32.0.0/16", "11.0.0.0/8", "192.169.0.0/16", "169.254.0.0/16"]) {
      expect(isPrivate(cidr(value)), value).toBe(false);
    }
  });
});

describe("describeCidrProblem", () => {
  const bounds = { min: 16, max: 28 };

  it("accepts a well-formed private block in range", () => {
    expect(describeCidrProblem("10.0.0.0/16", bounds)).toBeNull();
    expect(describeCidrProblem("192.168.1.0/28", bounds)).toBeNull();
  });

  it("explains each way it can be wrong", () => {
    expect(describeCidrProblem("nonsense", bounds)).toMatch(/CIDR form/);
    expect(describeCidrProblem("10.0.0.0/8", bounds)).toMatch(/too large/);
    expect(describeCidrProblem("10.0.0.0/30", bounds)).toMatch(/too small/);
    expect(describeCidrProblem("8.8.8.0/24", bounds)).toMatch(/private range/);
  });

  it("refuses public address space even when the size is fine", () => {
    // Routing space you do not own makes traffic to its real owner disappear into the VPC.
    expect(describeCidrProblem("1.1.1.0/24", bounds)).not.toBeNull();
    expect(describeCidrProblem("169.254.169.0/24", bounds)).not.toBeNull();
  });
});
