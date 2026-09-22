import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { getEnv } from "../env";
import { AppError } from "../errors";

/**
 * Envelope encryption for secrets at rest (ExternalIds, optional access-key secrets).
 *
 *   plaintext --AES-256-GCM(dataKey, aad=context)--> ciphertext
 *   dataKey   --wrapped by KMS (prod) or local master key (dev/test)--> wrappedKey
 *
 * Serialised as: v1.<provider>.<wrappedKey>.<iv>.<ciphertext>.<tag>   (base64url parts)
 *
 * The `context` string (e.g. "aws_connection:{orgId}:{connectionId}:externalId") is bound as AAD
 * and as the KMS EncryptionContext, so a ciphertext copied to another row/tenant fails to decrypt.
 * Plaintext data keys are zeroed after use.
 */

const VERSION = "v1";

export interface KeyProvider {
  readonly id: "local" | "kms";
  generateDataKey(context: string): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrapDataKey(wrapped: Buffer, context: string): Promise<Buffer>;
}

class LocalKeyProvider implements KeyProvider {
  readonly id = "local" as const;
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error("local master key must be 32 bytes");
  }
  async generateDataKey(context: string) {
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    cipher.setAAD(Buffer.from(`wrap:${context}`));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { plaintext, wrapped: Buffer.concat([iv, ct, cipher.getAuthTag()]) };
  }
  async unwrapDataKey(wrapped: Buffer, context: string) {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(wrapped.length - 16);
    const ct = wrapped.subarray(12, wrapped.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAAD(Buffer.from(`wrap:${context}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

class KmsKeyProvider implements KeyProvider {
  readonly id = "kms" as const;
  private readonly client: KMSClient;
  constructor(
    private readonly keyId: string,
    region: string,
  ) {
    // Credentials come from the platform's default provider chain (ECS task role etc.).
    this.client = new KMSClient({ region, maxAttempts: 3 });
  }
  async generateDataKey(context: string) {
    const res = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: { app: "stratus", context },
      }),
    );
    if (!res.Plaintext || !res.CiphertextBlob) throw new Error("KMS returned no data key");
    return { plaintext: Buffer.from(res.Plaintext), wrapped: Buffer.from(res.CiphertextBlob) };
  }
  async unwrapDataKey(wrapped: Buffer, context: string) {
    const res = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: wrapped,
        KeyId: this.keyId,
        EncryptionContext: { app: "stratus", context },
      }),
    );
    if (!res.Plaintext) throw new Error("KMS returned no plaintext");
    return Buffer.from(res.Plaintext);
  }
}

let provider: KeyProvider | undefined;

export function getKeyProvider(): KeyProvider {
  if (provider) return provider;
  const env = getEnv();
  provider =
    env.ENCRYPTION_PROVIDER === "kms"
      ? new KmsKeyProvider(env.KMS_KEY_ID as string, env.KMS_REGION as string)
      : new LocalKeyProvider(Buffer.from(env.LOCAL_MASTER_KEY as string, "base64"));
  return provider;
}

/** Test seam. */
export function setKeyProviderForTests(p: KeyProvider | undefined): void {
  provider = p;
}

export function createLocalKeyProvider(masterKey: Buffer): KeyProvider {
  return new LocalKeyProvider(masterKey);
}

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export async function encryptSecret(plaintext: string, context: string): Promise<string> {
  const kp = getKeyProvider();
  const { plaintext: dataKey, wrapped } = await kp.generateDataKey(context);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
    cipher.setAAD(Buffer.from(context));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, kp.id, b64(wrapped), b64(iv), b64(ct), b64(cipher.getAuthTag())].join(".");
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptSecret(envelope: string, context: string): Promise<string> {
  const parts = envelope.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) {
    throw new AppError("INTERNAL", "Stored secret could not be read.");
  }
  const [, providerId, wrapped, iv, ct, tag] = parts as [string, string, string, string, string, string];
  const kp = getKeyProvider();
  if (providerId !== kp.id) {
    throw new AppError("INTERNAL", "Stored secret was encrypted with a different key provider.");
  }
  let dataKey: Buffer | undefined;
  try {
    dataKey = await kp.unwrapDataKey(unb64(wrapped), context);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, unb64(iv));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new AppError("INTERNAL", "Stored secret could not be decrypted.", { cause });
  } finally {
    dataKey?.fill(0);
  }
}
