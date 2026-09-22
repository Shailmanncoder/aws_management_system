import { describe, expect, it } from "vitest";
import { REDACTED, redact, redactString } from "@/server/logging/redact";

// Well-known AWS documentation example credentials (not real).
const AKID = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const STS_TOKEN = `IQoJb3JpZ2luX2VjE${"A".repeat(300)}`;

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = redact({
      credentials: { AccessKeyId: "ASIAXXXXXXXXXXXXXXXX", SecretAccessKey: SECRET, SessionToken: STS_TOKEN },
      nested: { deeper: { password: "hunter2", authorization: "Bearer abc.def.ghi", cookie: "x=y" } },
      externalId: "stratus-abc",
      ok: "visible",
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain(SECRET);
    expect(s).not.toContain(STS_TOKEN);
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("stratus-abc");
    expect(s).toContain("visible");
  });

  it("redacts credential-shaped values inside free text", () => {
    const msg = `failed with key ${AKID} and aws_secret_access_key=${SECRET} token ${STS_TOKEN}`;
    const out = redactString(msg);
    expect(out).not.toContain(AKID);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(STS_TOKEN);
    expect(out).toContain(REDACTED);
  });

  it("masks passwords in connection URLs", () => {
    expect(redactString("postgresql://user:s3cr3t@db:5432/x")).toBe(`postgresql://user:${REDACTED}@db:5432/x`);
  });

  it("redacts JWTs, bearer tokens and PEM private keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactString(`t=${jwt}`)).not.toContain(jwt);
    expect(redactString("Authorization: Bearer abcdefghijk123")).not.toContain("abcdefghijk123");
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
    expect(redactString(pem)).toBe(REDACTED);
  });

  it("strips control characters to prevent log forging", () => {
    const out = redactString("user\ninput\r\n{\"level\":\"error\"}\u2028x");
    expect(out).not.toMatch(/[\n\r\u2028]/);
  });

  it("handles cycles, errors, maps and proto keys safely", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const err = Object.assign(new Error(`boom ${AKID}`), { code: "AccessDenied" });
    const hostile = JSON.parse('{"__proto__": {"polluted": true}}') as object;
    const out = redact({ a, err, m: new Map([["secret", "x"]]), hostile }) as Record<string, unknown>;
    expect(JSON.stringify(out)).toContain("[Circular]");
    expect(JSON.stringify(out)).not.toContain(AKID);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const input = { password: "p" };
    redact(input);
    expect(input.password).toBe("p");
  });

  it("keeps explicitly safe metadata keys", () => {
    const out = redact({ accessKeyHint: "…WXYZ", sessionName: "stratus-1" }) as Record<string, unknown>;
    expect(out.accessKeyHint).toBe("…WXYZ");
    expect(out.sessionName).toBe("stratus-1");
  });
});
