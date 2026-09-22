import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import type { Permission } from "@/lib/rbac";
import { getSessionFromHeaders, type SessionUser } from "../auth/session";
import { authorizeOrg, type OrgAccess } from "../authz/guard";
import { getEnv } from "../env";
import { AppError, isAppError, unauthenticated } from "../errors";
import { runWithContext } from "../logging/context";
import { logger } from "../logging/logger";
import { recordApiLatency } from "../observability/metrics";
import { enforceRateLimit, type RateLimitPolicyName } from "../security/rate-limit";
import { assertSameOrigin } from "./csrf";
import { readJsonBody } from "./safe-json";

/**
 * The single wrapper every API route handler goes through:
 *
 *   request id → CSRF/origin check → authentication → org membership + permission →
 *   rate limit → strict Zod validation (params/query/body) → handler → sanitised response
 *
 * Handlers never see raw request input — only validated, typed values.
 */

type Schema = z.ZodType;
type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined;

interface BaseOptions<P, Q, B> {
  params?: P;
  query?: Q;
  body?: B;
  /** Rate-limit policy; subject is the user (or org for org-scoped routes, see rateLimitBy). */
  rateLimit?: RateLimitPolicyName;
  rateLimitBy?: "user" | "org";
  operation: string;
}

interface Ctx<P, Q, B> {
  req: Request;
  requestId: string;
  user: SessionUser;
  params: Infer<P>;
  query: Infer<Q>;
  body: Infer<B>;
}

type OrgCtx<P, Q, B> = Ctx<P, Q, B> & { access: OrgAccess };

/** Next.js omits `params` entirely for routes without dynamic segments. */
type RouteContext = { params?: Promise<Record<string, string | string[]>> } | undefined;

export function userRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined>(
  opts: BaseOptions<P, Q, B>,
  handler: (ctx: Ctx<P, Q, B>) => Promise<unknown>,
) {
  return (req: Request, rc: RouteContext) =>
    execute(req, rc, opts, async (base) => {
      if (opts.rateLimit) await enforceRateLimit(opts.rateLimit, `user:${base.user.id}`);
      return handler(base);
    });
}

/** Org-scoped route. The org id comes from the `orgId` path param and is verified via membership. */
export function orgRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined>(
  opts: BaseOptions<P, Q, B> & { permission: Permission },
  handler: (ctx: OrgCtx<P, Q, B>) => Promise<unknown>,
) {
  return (req: Request, rc: RouteContext) =>
    execute(req, rc, opts, async (base, rawParams) => {
      const access = await authorizeOrg(base.user.id, rawParams.orgId, opts.permission);
      if (opts.rateLimit) {
        const subject = opts.rateLimitBy === "org" ? `org:${access.organizationId}` : `user:${base.user.id}`;
        await enforceRateLimit(opts.rateLimit, subject);
      }
      return handler({ ...base, access });
    });
}

async function execute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined>(
  req: Request,
  rc: RouteContext,
  opts: BaseOptions<P, Q, B>,
  run: (base: Ctx<P, Q, B>, rawParams: Record<string, unknown>) => Promise<unknown>,
): Promise<Response> {
  // The proxy sets x-request-id (overwriting any client value); fall back if absent.
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  const started = performance.now();

  return runWithContext({ requestId, operation: opts.operation }, async () => {
    let status = 500;
    try {
      const env = getEnv();
      assertSameOrigin(req, env.APP_URL);

      const user = await getSessionFromHeaders(req.headers);
      if (!user) throw unauthenticated();

      const rawParams = ((await rc?.params) ?? {}) as Record<string, unknown>;
      const { orgId: _orgId, ...restParams } = rawParams;
      void _orgId;
      const url = new URL(req.url);
      const params = opts.params ? opts.params.parse(restParams) : undefined;
      const query = opts.query ? opts.query.parse(Object.fromEntries(url.searchParams)) : undefined;
      let body: unknown;
      if (opts.body) body = opts.body.parse(await readJsonBody(req));

      const result = await run(
        { req, requestId, user, params: params as Infer<P>, query: query as Infer<Q>, body: body as Infer<B> },
        rawParams,
      );
      if (result instanceof Response) {
        status = result.status;
        result.headers.set("x-request-id", requestId);
        return result;
      }
      status = 200;
      return json(result ?? { ok: true }, 200, requestId);
    } catch (err) {
      const res = toErrorResponse(err, requestId);
      status = res.status;
      return res;
    } finally {
      const durationMs = Math.round(performance.now() - started);
      recordApiLatency(opts.operation, status, durationMs);
      logger.info("api request", { method: req.method, operation: opts.operation, status, durationMs });
    }
  });
}

export function json(data: unknown, status: number, requestId: string): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

/** Converts any thrown value into a sanitised response. Stack traces / internals never leak. */
export function toErrorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof ZodError) {
    const issues = err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));
    return json({ error: { code: "VALIDATION_FAILED", message: "The request is invalid.", issues, requestId } }, 400, requestId);
  }
  if (isAppError(err)) {
    if (err.status >= 500) logger.error("request failed", { code: err.code, err });
    else logger.info("request rejected", { code: err.code });
    const res = json(
      { error: { code: err.code, message: err.publicMessage, issues: err.issues, requestId } },
      err.status,
      requestId,
    );
    if (err.retryAfterSeconds) res.headers.set("retry-after", String(err.retryAfterSeconds));
    return res;
  }
  logger.error("unhandled error", { err });
  const internal = new AppError("INTERNAL", "An unexpected error occurred. Reference the request ID when contacting support.");
  return json({ error: { code: internal.code, message: internal.publicMessage, requestId } }, 500, requestId);
}
