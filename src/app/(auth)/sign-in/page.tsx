import { getEnv } from "@/server/env";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { enabledOAuthProviders } from "@/server/auth/providers";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const target = safeRedirectPath(typeof next === "string" ? next : undefined);
  return <SignInForm recoveryEnabled={getEnv().MAIL_TRANSPORT !== "disabled"} next={target} oauth={enabledOAuthProviders()} />;
}
