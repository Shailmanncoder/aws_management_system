import Link from "next/link";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 10 || token.length > 512) return <p>This reset link is invalid or expired. <Link href="/forgot-password">Request another link</Link>.</p>;
  return <PasswordRecoveryForm token={token} />;
}
