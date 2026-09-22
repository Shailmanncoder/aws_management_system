"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PasswordRecoveryForm({ token }: { token?: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Card><CardHeader><CardTitle>{token ? "Set a new password" : "Reset your password"}</CardTitle></CardHeader><CardContent>
    {done ? <p role="status" className="text-sm">{token ? "Password updated. Sign in with your new password." : "If this email belongs to an account, you will receive a password reset link."}</p> : <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const data = new FormData(e.currentTarget);
      try {
        const result = token ? await authClient.resetPassword({ token, newPassword: String(data.get("password")) }) : await authClient.requestPasswordReset({ email: String(data.get("email")), redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) setError(token ? "This reset link is invalid or expired. Request a new one." : "Unable to request a reset right now. Please try again later.");
        else setDone(true);
      } catch { setError("Unable to connect. Please try again."); } finally { setPending(false); }
    }}>
      {token ? <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></div> : <div className="space-y-2"><Label htmlFor="recovery-email">Email</Label><Input id="recovery-email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} type="submit">{pending ? "Please wait…" : token ? "Update password" : "Send reset link"}</Button>
    </form>}
    <Link href="/sign-in" className="mt-4 block text-sm text-primary hover:underline">Return to sign in</Link>
  </CardContent></Card>;
}
