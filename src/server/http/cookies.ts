import "server-only";
import { getEnv } from "../env";

/** Active-workspace selection cookie: not a credential (membership is re-checked every request). */
export function activeOrgCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().APP_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  };
}
