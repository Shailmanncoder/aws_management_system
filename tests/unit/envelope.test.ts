import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXTERNAL_ID_PATTERN, generateExternalId } from "@/server/security/crypto";
import { createLocalKeyProvider, decryptSecret, encryptSecret, setKeyProviderForTests } from "@/server/security/envelope";

describe("envelope encryption", () => {
  beforeEach(() => setKeyProviderForTests(createLocalKeyProvider(Buffer.alloc(32, 9))));
  afterEach(() => setKeyProviderForTests(undefined));

  it("round-trips and never contains the plaintext", async () => {
    const env = await encryptSecret("super-secret-value", "ctx:org-a:conn-1");
    expect(env).not.toContain("super-secret-value");
    expect(env.startsWith("v1.local.")).toBe(true);
    await expect(decryptSecret(env, "ctx:org-a:conn-1")).resolves.toBe("super-secret-value");
  });

  it("uses a fresh data key and IV each time", async () => {
    const a = await encryptSecret("same", "ctx");
    const b = await encryptSecret("same", "ctx");
    expect(a).not.toBe(b);
  });

  it("binds ciphertext to its context (no cross-tenant/row swap)", async () => {
    const env = await encryptSecret("value", "aws_connection:org-a:conn-1:externalId");
    await expect(decryptSecret(env, "aws_connection:org-b:conn-1:externalId")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const env = await encryptSecret("value", "ctx");
    const parts = env.split(".");
    const ct = Buffer.from(parts[4]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString("base64url");
    await expect(decryptSecret(parts.join("."), "ctx")).rejects.toThrow();
  });

  it("fails with a different master key", async () => {
    const env = await encryptSecret("value", "ctx");
    setKeyProviderForTests(createLocalKeyProvider(Buffer.alloc(32, 1)));
    await expect(decryptSecret(env, "ctx")).rejects.toThrow();
  });
});

describe("ExternalId generation", () => {
  it("is high-entropy, unique and AWS-charset compliant", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateExternalId()));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(EXTERNAL_ID_PATTERN);
      expect(id).toMatch(/^[\w+=,.@:/-]{2,1224}$/);
    }
  });
});
