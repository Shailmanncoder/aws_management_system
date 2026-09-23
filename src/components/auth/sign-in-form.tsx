"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import type { OAuthProvider } from "@/lib/oauth";
import { OAuthButtons } from "./oauth-buttons";

export function SignInForm({ next, oauth, recoveryEnabled = false }: { recoveryEnabled?: boolean; next: string; oauth: OAuthProvider[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error: err } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (err) {
      // Generic message: do not reveal whether the account exists.
      setError(err.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Unable to sign in. Check your credentials and verify your email if required.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/sign-in/two-factor");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Access your cloud workspaces.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {recoveryEnabled && <Link href="/forgot-password" className="block text-sm text-primary hover:underline">Forgot password?</Link>}
        <OAuthButtons providers={oauth} callbackURL={next} />
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/sign-up${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
