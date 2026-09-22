import { randomUUID } from "node:crypto";
import { getAuth } from "@/server/auth/auth";

export const APP_URL = "http://localhost:3000";

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** Signs up a real user through Better Auth and returns its session cookie. */
export async function createUser(prefix = "user"): Promise<TestUser> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
  const res = await getAuth().api.signUpEmail({
    body: { email, password: "correct horse battery staple", name: prefix },
    headers: new Headers({ origin: APP_URL, "x-stratus-client-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
    asResponse: true,
  });
  if (!res.ok) throw new Error(`signup failed: ${res.status}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { id: body.user.id, email, cookie };
}

type Handler = (req: Request, ctx: { params?: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  handler: Handler,
  opts: {
    method?: string;
    path?: string;
    params?: Record<string, string>;
    body?: unknown;
    user?: TestUser;
    cookie?: string;
    origin?: string | null;
    rawBody?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const method = opts.method ?? (opts.body === undefined && opts.rawBody === undefined ? "GET" : "POST");
  const headers = new Headers();
  const cookie = opts.cookie ?? opts.user?.cookie;
  if (cookie) headers.set("cookie", cookie);
  if (opts.origin !== null) headers.set("origin", opts.origin ?? APP_URL);
  if (opts.body !== undefined || opts.rawBody !== undefined) headers.set("content-type", opts.contentType ?? "application/json");
  const req = new Request(`${APP_URL}${opts.path ?? "/api/test"}`, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  // Mirror Next.js: static routes receive no params at all.
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : {});
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}
