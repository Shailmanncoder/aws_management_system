import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { getEnv } from "@/server/env";
export default function ForgotPasswordPage() {
  if (getEnv().MAIL_TRANSPORT === "disabled") return <p>Email recovery is not configured. Contact your deployment administrator.</p>;
  return <PasswordRecoveryForm />;
}
