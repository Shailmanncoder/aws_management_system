/**
 * Open-redirect protection: only same-origin relative paths are accepted as post-login targets.
 * Rejects absolute URLs, protocol-relative ("//evil"), backslash tricks ("/\\evil"), and
 * control characters.
 */
export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (!input || typeof input !== "string") return fallback;
  if (input.length > 512) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001F\u007F\\]/.test(input)) return fallback;
  try {
    const u = new URL(input, "http://stratus.invalid");
    if (u.origin !== "http://stratus.invalid") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
