import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request / per-job context propagated through async calls so every log line carries
 * correlation identifiers without passing them explicitly.
 */
export interface RequestContext {
  requestId: string;
  organizationId?: string;
  userId?: string;
  awsAccountRef?: string;
  jobId?: string;
  operation?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Adds fields to the current context (e.g. once the org has been resolved). */
export function enrichContext(fields: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}
