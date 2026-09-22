/**
 * Secret-redaction layer. Every log line and every error that crosses a trust boundary passes
 * through `redact`. It is deliberately conservative: a false positive costs a little debugging
 * context, a false negative leaks a credential.
 *
 * This module is dependency-free and has no `server-only` import so it can be unit-tested and
 * reused by the worker bundle.
 */

export const REDACTED = "[REDACTED]";

/** Object keys whose values are always redacted, regardless of content. */
const SENSITIVE_KEY =
  /(secret|password|passwd|pwd|token|authorization|cookie|session(?!Name)|credential|accesskey|access_key|privatekey|private_key|apikey|api_key|externalid|external_id|signature|ciphertext|masterkey|master_key|backupcodes|otp|totp|databaseurl|database_url|connectionstring|dsn|x-amz-security-token)/i;

/** Keys that look sensitive but are safe metadata. */
const SAFE_KEY = /^(accessKeyHint|tokenType|sessionDurationSeconds|hasSessionToken|sessionName|externalIdHint|credentialRotatedAt|passwordPolicy)$/;

interface ValuePattern {
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
}

/** Value patterns redacted anywhere in free text. */
const VALUE_PATTERNS: ValuePattern[] = [
  // AWS access key IDs (long-term AKIA, temporary ASIA, and other documented prefixes)
  { pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  // aws_secret_access_key = xxx / "SecretAccessKey":"xxx" in free text
  {
    pattern: /((?:aws_?)?secret_?access_?key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{30,}/gi,
    replace: (_m: string, p1: string) => `${p1}${REDACTED}`,
  },
  // STS session tokens are long base64 blobs (typically 300+ chars)
  { pattern: /\b(?:IQoJb3JpZ2lu|FwoGZXIvYXdzE)[A-Za-z0-9/+=]{50,}/g, replace: REDACTED },
  // Bearer / Basic authorization values
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: (_m: string, p1: string) => `${p1} ${REDACTED}` },
  // JWTs
  { pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replace: REDACTED },
  // Credentials embedded in URLs: scheme://user:password@host
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi,
    replace: (_m: string, p1: string) => `${p1}${REDACTED}@`,
  },
  // PEM private keys
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: REDACTED },
  // Cookie headers in free text
  { pattern: /(better-auth\.[a-z_]+=)[^;\s]+/gi, replace: (_m: string, p1: string) => `${p1}${REDACTED}` },
];

// Control characters (except \t) are stripped from strings to prevent log forging/injection.
const CONTROL_CHARS = /[\u0000-\u0008\u000A-\u001F\u007F\u2028\u2029]/g;

const MAX_DEPTH = 8;
const MAX_STRING = 4000;
const MAX_ARRAY = 100;

export function redactString(input: string): string {
  let out = input;
  for (const { pattern, replace } of VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    out = typeof replace === "string" ? out.replace(pattern, replace) : out.replace(pattern, replace as (m: string, ...g: string[]) => string);
  }
  out = out.replace(CONTROL_CHARS, " ");
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return !SAFE_KEY.test(key) && SENSITIVE_KEY.test(key);
}

/**
 * Deep-redacts a value. Returns a new structure; input is never mutated.
 * Handles cycles, depth limits, Errors, Maps/Sets, Buffers and class instances.
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[binary ${value.length} bytes]`;
    if (value instanceof Error) return redactError(value, depth, seen);
    if (value instanceof Map) {
      return redact(Object.fromEntries(value.entries()), depth + 1, seen);
    }
    if (value instanceof Set) return redact([...value], depth + 1, seen);
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) items.push(`…${value.length - MAX_ARRAY} more`);
      return items;
    }

    // Plain objects and class instances: own enumerable props only. Use a null-prototype
    // output object so hostile keys like "__proto__" cannot pollute prototypes.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = redactString(k);
      out[safeKey] = isSensitiveKey(k) ? (v === null || v === undefined || v === "" ? v : REDACTED) : redact(v, depth + 1, seen);
    }
    return out;
  }
  return "[unknown]";
}

function redactError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactString(err.message ?? ""),
  };
  const meta = err as Error & { code?: unknown; $metadata?: { httpStatusCode?: number; requestId?: string } };
  if (typeof meta.code === "string") out.code = meta.code;
  if (meta.$metadata) {
    out.httpStatusCode = meta.$metadata.httpStatusCode;
    out.awsRequestId = meta.$metadata.requestId;
  }
  if (process.env.APP_ENV !== "production" && err.stack) {
    out.stack = redactString(err.stack.split("\n").slice(0, 8).join(" | "));
  }
  if (err.cause !== undefined) out.cause = redact(err.cause, depth + 1, seen);
  return out;
}
