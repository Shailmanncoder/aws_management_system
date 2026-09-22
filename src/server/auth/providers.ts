import "server-only";
import { getEnv } from "../env";

export type OAuthProvider = "github" | "google";

/** Names of configured OAuth providers (no secrets). */
export function enabledOAuthProviders(): OAuthProvider[] {
  const env = getEnv();
  const out: OAuthProvider[] = [];
  if (env.AUTH_GITHUB_CLIENT_ID) out.push("github");
  if (env.AUTH_GOOGLE_CLIENT_ID) out.push("google");
  return out;
}
