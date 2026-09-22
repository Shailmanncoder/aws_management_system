import "server-only";
import { sendAuthEmail } from "./mail";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { getDb } from "../db";
import { getEnv } from "../env";
import { logger } from "../logging/logger";
import { recordAudit } from "../services/audit-service";

/**
 * Better Auth configuration.
 *
 * - Database-backed sessions (no cookie cache) → sessions can be revoked instantly and every
 *   request re-validates against the DB.
 * - Cookies: httpOnly, SameSite=Lax, Secure in production (Better Auth defaults + useSecureCookies).
 * - Built-in origin/CSRF checks for auth endpoints; trustedOrigins pinned to APP_URL.
 * - TOTP MFA via the twoFactor plugin (users opt in; org-level enforcement is roadmap).
 * - Rate limits persisted in PostgreSQL so they hold across instances.
 */
function createAuth() {
  const env = getEnv();
  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] = {};
  if (env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: env.AUTH_GITHUB_CLIENT_ID, clientSecret: env.AUTH_GITHUB_CLIENT_SECRET };
  }
  if (env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.AUTH_GOOGLE_CLIENT_ID, clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET };
  }

  return betterAuth({
    appName: "Stratus",
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    trustedOrigins: [new URL(env.APP_URL).origin],
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      ...(env.MAIL_TRANSPORT === "disabled" ? {} : { sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => sendAuthEmail(user.email, "Reset your Stratus password", url) }),
    },
    emailVerification: {
      sendOnSignUp: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      sendOnSignIn: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: false,
      ...(env.MAIL_TRANSPORT === "disabled" ? {} : { sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => sendAuthEmail(user.email, "Verify your Stratus email", url) }),
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 12, // 12h absolute
      updateAge: 60 * 60, // sliding refresh at most hourly
      freshAge: 60 * 10, // sensitive operations require a session younger than 10 min
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 10 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/request-password-reset": { window: 3600, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env.APP_ENV === "production",
      cookiePrefix: "stratus",
      database: { generateId: "uuid" },
      ipAddress: {
        // Set by src/proxy.ts from the trusted proxy chain; client-supplied values are overwritten.
        ipAddressHeaders: ["x-stratus-client-ip"],
      },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    plugins: [twoFactor({ issuer: "Stratus" }), nextCookies()],
    logger: {
      level: "warn",
      log: (level, message) => {
        // Better Auth messages are routed through our redacting logger.
        const lvl = level === "error" ? "error" : level === "warn" ? "warn" : "info";
        logger[lvl]("auth", { authMessage: message });
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await recordAudit({
              action: "auth.login",
              actorUserId: session.userId,
              outcome: "SUCCESS",
              targetType: "user",
              targetId: session.userId,
              ipAddress: session.ipAddress ?? undefined,
              userAgent: session.userAgent ?? undefined,
            });
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            await recordAudit({
              action: "auth.signup",
              actorUserId: user.id,
              outcome: "SUCCESS",
              targetType: "user",
              targetId: user.id,
            });
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __stratusAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__stratusAuth) globalForAuth.__stratusAuth = createAuth();
  return globalForAuth.__stratusAuth;
}
