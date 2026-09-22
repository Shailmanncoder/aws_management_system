import { afterEach, describe, expect, it } from "vitest";
import { runWithContext } from "@/server/logging/context";
import { logger, setLogSinkForTests } from "@/server/logging/logger";

describe("logger", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("emits JSON with context and never raw secrets", () => {
    const lines: string[] = [];
    restore = setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "debug";
    runWithContext({ requestId: "req-12345678", organizationId: "org-1", userId: "u-1" }, () => {
      logger.info("assume role", {
        SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        sessionToken: "IQoJb3JpZ2lu" + "B".repeat(200),
        roleArn: "arn:aws:iam::123456789012:role/Stratus",
      });
    });
    process.env.LOG_LEVEL = "error";
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.requestId).toBe("req-12345678");
    expect(entry.organizationId).toBe("org-1");
    expect(entry.roleArn).toBe("arn:aws:iam::123456789012:role/Stratus");
    expect(lines[0]).not.toContain("wJalrXUtnFEMI");
    expect(lines[0]).not.toContain("IQoJb3JpZ2lu");
  });

  it("respects log level threshold", () => {
    const lines: string[] = [];
    restore = setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "error";
    logger.info("hidden");
    logger.error("shown");
    expect(lines).toHaveLength(1);
  });
});
