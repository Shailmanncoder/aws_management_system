"use client";

/**
 * Thin fetch wrapper for our own JSON API. Same-origin only, JSON bodies only (part of the CSRF
 * defence), and errors surface the sanitised server message + request ID.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; requestId?: string; issues?: { path: string; message: string }[] };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("api() only calls same-origin /api routes");
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const e = (data as ErrorBody | undefined)?.error;
    throw new ApiError(
      e?.message ?? `Request failed (${res.status})`,
      e?.code ?? "UNKNOWN",
      res.status,
      e?.requestId,
      e?.issues,
    );
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.requestId ? `${e.message} (ref: ${e.requestId.slice(0, 8)})` : e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
