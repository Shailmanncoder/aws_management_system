import { AppError } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *   1. SameSite=Lax session cookies (set by Better Auth) block most cross-site sends.
 *   2. Origin must exactly match APP_URL's origin (or Sec-Fetch-Site must be same-origin).
 *   3. Bodies must be application/json (enforced in readJsonBody) → cross-site forms cannot
 *      produce them without a CORS preflight, which we never grant.
 */
export function assertSameOrigin(req: Request, appUrl: string): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const expected = new URL(appUrl).origin;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  if (origin) {
    if (origin !== expected) throw new AppError("CSRF_REJECTED", "Cross-origin request rejected.");
    return;
  }
  if (fetchSite === "same-origin") return;
  throw new AppError("CSRF_REJECTED", "Cross-origin request rejected.");
}
