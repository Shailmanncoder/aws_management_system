import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge of the application (Next.js 16 "proxy", formerly middleware):
 *  - Generates a fresh request id and overwrites any client-supplied `x-request-id`.
 *  - Derives the client IP from the trusted proxy chain and overwrites `x-stratus-client-ip`
 *    so clients cannot spoof the IP used for auth rate limiting.
 *  - Issues a per-request CSP nonce for HTML pages (strict-dynamic).
 *  - Redirects unauthenticated page requests to /sign-in (UX only — authorization is enforced
 *    server-side in every page/route; the cookie check here is NOT a security boundary).
 */

const PUBLIC_PAGES = ["/sign-in", "/sign-up", "/invite", "/legal"];
const SESSION_COOKIES = ["stratus.session_token", "__Secure-stratus.session_token"];

function clientIp(req: NextRequest): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  const xff = req.headers.get("x-forwarded-for");
  if (!xff || !Number.isInteger(hops) || hops <= 0) return "unknown";
  const chain = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Each trusted proxy appends the address it received from; the client address is the entry
  // `hops` positions from the right. Entries further left are client-controlled.
  const candidate = chain[chain.length - hops];
  return candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : "unknown";
}

function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Radix UI and Recharts set inline style attributes; nonces cannot cover style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-stratus-client-ip", clientIp(request));

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("x-request-id", requestId);
    res.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    return res;
  }

  const hasSessionCookie = SESSION_COOKIES.some((c) => request.cookies.has(c));
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hasSessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Only a same-site relative path is carried forward (no open redirect).
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
