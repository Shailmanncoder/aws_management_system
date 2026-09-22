import { describe, expect, it } from "vitest";
import { cacheKey } from "@/server/cache/tenant-cache";

describe("tenant cache keys", () => {
  it("always include organization and version, and escape dimensions", () => {
    const a = cacheKey("org-a", 3, "dashboard", ["30d", "us-east-1"]);
    const b = cacheKey("org-b", 3, "dashboard", ["30d", "us-east-1"]);
    expect(a).not.toBe(b);
    expect(a.startsWith("org:org-a:v3:")).toBe(true);
    expect(cacheKey("org-a", 4, "dashboard", ["30d", "us-east-1"])).not.toBe(a);
    // A dimension cannot forge another tenant's prefix.
    expect(cacheKey("org-a", 1, "x", ["a:org:org-b"])).toContain("a%3Aorg%3Aorg-b");
  });
});
