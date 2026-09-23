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

export function SignUpForm({ next, oauth, verificationRequired = false }: { verificationRequired?: boolean; next: string; oauth: OAuthProvider[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (password !== String(form.get("confirm") ?? "")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    const { error: err } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim().slice(0, 100),
      email: String(form.get("email") ?? "").trim(),
      password,
    });
    setPending(false);
    if (err) {
      setError(err.status === 429 ? "Too many attempts. Please try again later." : "Could not create the account. Check your details and try again.");
      return;
    }
    if (verificationRequired) { setSent(true); return; }
    router.replace(next);
    router.refresh();
  }

  if (sent) return <Card><CardHeader><CardTitle>Check your email</CardTitle><CardDescription>Open the verification link, then sign in to continue.</CardDescription></CardHeader><CardContent><Link href="/sign-in">Return to sign in</Link></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Then create a workspace and connect AWS read-only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="pw-hint" />
            <p id="pw-hint" className="text-xs text-muted-foreground">At least 12 characters. A passphrase works well.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required maxLength={128} />
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <OAuthButtons providers={oauth} callbackURL={next} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
