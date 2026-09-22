import { describe, expect, it } from "vitest";
import { accountIdFromArn, isRootPrincipalArn, parseRoleArn } from "@/server/aws/arn";

describe("parseRoleArn", () => {
  it("parses valid role ARNs across partitions and paths", () => {
    expect(parseRoleArn("arn:aws:iam::123456789012:role/StratusReadOnlyRole")).toMatchObject({ accountId: "123456789012", roleName: "StratusReadOnlyRole", path: "/", partition: "aws" });
    expect(parseRoleArn("arn:aws-us-gov:iam::123456789012:role/team/sub/Stratus")).toMatchObject({ partition: "aws-us-gov", path: "/team/sub/", roleName: "Stratus" });
  });

  it.each([
    "arn:aws:iam::123456789012:user/alice",
    "arn:aws:iam::12345678901:role/x",
    "arn:aws:iam::1234567890123:role/x",
    "arn:aws:sts::123456789012:assumed-role/x/y",
    "arn:aws:iam::123456789012:role/",
    "arn:evil:iam::123456789012:role/x",
    "arn:aws:iam::123456789012:role/x y",
    "arn:aws:iam::123456789012:role/x\nInjected",
    "arn:aws:iam::123456789012:role/<script>",
    " arn:aws:iam::123456789012:role/../../etc",
    `arn:aws:iam::123456789012:role/${"a".repeat(65)}`,
    "",
    null,
    42,
  ])("rejects %s", (arn) => {
    expect(parseRoleArn(arn)).toBeNull();
  });

  it("extracts account ids and detects root principals", () => {
    expect(accountIdFromArn("arn:aws:sts::210987654321:assumed-role/R/s")).toBe("210987654321");
    expect(isRootPrincipalArn("arn:aws:iam::123456789012:root")).toBe(true);
    expect(isRootPrincipalArn("arn:aws:iam::123456789012:user/root")).toBe(false);
  });
});
