"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. It only ever talks to our own /api/auth endpoints; session cookies are
 * httpOnly and never readable from JS.
 */
export const authClient = createAuthClient({
  // The sign-in form handles `twoFactorRedirect` itself via the Next.js router.
  plugins: [twoFactorClient()],
});
