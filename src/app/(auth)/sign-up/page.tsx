import { getEnv } from "@/server/env";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { enabledOAuthProviders } from "@/server/auth/providers";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  return <SignUpForm verificationRequired={getEnv().AUTH_REQUIRE_EMAIL_VERIFICATION} next={safeRedirectPath(typeof next === "string" ? next : undefined, "/onboarding")} oauth={enabledOAuthProviders()} />;
}
