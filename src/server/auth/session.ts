import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { unauthenticated } from "../errors";
import { enrichContext } from "../logging/context";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  sessionCreatedAt: Date;
}

/** Resolves the session from request headers. Validated against the DB on every call. */
export async function getSessionFromHeaders(h: Headers): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers: h });
  if (!result) return null;
  const { user, session } = result;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    sessionCreatedAt: session.createdAt,
  };
}

/** RSC helper, memoised per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const user = await getSessionFromHeaders(await headers());
  if (user) enrichContext({ userId: user.id });
  return user;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}
