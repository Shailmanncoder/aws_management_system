import { AppError } from "../errors";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parses a JSON request body with a hard size cap and prototype-pollution protection:
 * `__proto__`, `constructor` and `prototype` keys are rejected outright.
 */
export async function readJsonBody(req: Request, maxBytes: number = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.");

  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    throw new AppError("VALIDATION_FAILED", "Content-Type must be application/json.");
  }

  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return parseJsonSafely(text);
}

export function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) throw new PollutionError();
      return value;
    });
  } catch (e) {
    if (e instanceof PollutionError) {
      throw new AppError("VALIDATION_FAILED", "Request body contains forbidden keys.");
    }
    throw new AppError("VALIDATION_FAILED", "Request body is not valid JSON.");
  }
}

class PollutionError extends Error {}
