import { classifyAwsError } from "./errors";

/**
 * Outer retry for AWS operations, layered on top of the SDK's own adaptive retry. Used around
 * whole collector units (e.g. "all EC2 pages in eu-west-1") so a throttling burst that exhausts
 * SDK retries is retried with a longer, fully-jittered exponential backoff.
 *
 * delay_n = random(0, min(maxDelay, base * 2^n))   ("full jitter", AWS Architecture Blog)
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; errorClass: string }) => void;
}

const RETRYABLE = new Set(["throttled", "service_unavailable"]);

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(random() * cap);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 20_000;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const cls = classifyAwsError(err);
      if (!RETRYABLE.has(cls) || attempt + 1 >= maxAttempts) throw err;
      const delayMs = backoffDelay(attempt, base, maxDelay, random);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, errorClass: cls });
      await sleep(delayMs);
    }
  }
}
