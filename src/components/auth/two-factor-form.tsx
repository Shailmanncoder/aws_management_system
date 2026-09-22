"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (res.error) {
      setError(res.error.status === 429 ? "Too many attempts. Please wait." : "Invalid code.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor verification</CardTitle>
        <CardDescription>
          {useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{useBackup ? "Backup code" : "Authentication code"}</Label>
            <Input
              id="code"
              name="code"
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              required
              maxLength={useBackup ? 32 : 6}
              pattern={useBackup ? undefined : "[0-9]{6}"}
            />
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            Verify
          </Button>
          <Button type="button" variant="link" className="w-full" onClick={() => setUseBackup((v) => !v)}>
            {useBackup ? "Use authenticator code" : "Use a backup code"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
