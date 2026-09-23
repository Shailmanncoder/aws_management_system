/**
 * OAuth providers the app can offer. Client-safe: the sign-in and sign-up forms need the names
 * and labels, and the server decides which are actually configured (see server/auth/providers).
 * Only names and display text live here — never client ids or secrets.
 */
export const OAUTH_PROVIDERS = ["github", "google", "linkedin"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_LABELS: Record<OAuthProvider, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
  linkedin: "Continue with LinkedIn",
};
