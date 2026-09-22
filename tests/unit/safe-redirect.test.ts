import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath (open redirect protection)", () => {
  it.each([
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
    ["/\nfoo", "/"],
    [null, "/"],
    ["", "/"],
    ["/cloud/ec2?region=us-east-1", "/cloud/ec2?region=us-east-1"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});
