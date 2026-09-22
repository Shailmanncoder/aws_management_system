"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const res = enabled ? await authClient.twoFactor.disable({ password }) : await authClient.twoFactor.enable({ password });
    setPending(false);
    if (res.error) {
      setError("Password incorrect or request rejected.");
      return;
    }
    if (enabled) {
      toast.success("Two-factor authentication disabled");
      router.refresh();
      return;
    }
    const data = res.data as { totpURI: string; backupCodes: string[] };
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ secret, uri: data.totpURI, backupCodes: data.backupCodes });
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    const res = await authClient.twoFactor.verifyTotp({ code });
    if (res.error) {
      setError("Invalid code. Check your authenticator's clock and try again.");
      return;
    }
    toast.success("Two-factor authentication enabled");
    setSetup(null);
    router.refresh();
  }

  if (setup) {
    return (
      <div className="space-y-4 text-sm">
        <p>Add this key to your authenticator app (manual entry, time-based):</p>
        <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{setup.secret}</code>
        <div>
          <p className="font-medium">Backup codes — store them somewhere safe. They are shown once.</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <form onSubmit={verify} className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="totp">6-digit code</Label>
            <Input id="totp" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
          </div>
          <Button type="submit">Verify & enable</Button>
        </form>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={start} className="space-y-3 text-sm">
      <p>
        Status: <strong>{enabled ? "Enabled" : "Not enabled"}</strong>
      </p>
      <div className="space-y-1">
        <Label htmlFor="pw">Confirm your password</Label>
        <Input id="pw" name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant={enabled ? "destructive" : "default"} disabled={pending}>
        {enabled ? "Disable two-factor" : "Set up two-factor"}
      </Button>
    </form>
  );
}
