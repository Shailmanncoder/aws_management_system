"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const LABELS = { github: "Continue with GitHub", google: "Continue with Google" } as const;

export function OAuthButtons({ providers, callbackURL }: { providers: ("github" | "google")[]; callbackURL: string }) {
  if (providers.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="bg-card px-2">or</span>
      </div>
      {providers.map((p) => (
        <Button
          key={p}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: p, callbackURL })}
        >
          {LABELS[p]}
        </Button>
      ))}
    </div>
  );
}
