"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api-client";

export function AcceptInvite({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join workspace</CardTitle>
        <CardDescription>You are signed in as {email}. The invitation must have been sent to this address.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button
          className="w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await api("/api/v1/invitations/accept", { body: { token } });
              router.replace("/");
              router.refresh();
            } catch (e) {
              setError(errorMessage(e));
              setPending(false);
            }
          }}
        >
          Accept invitation
        </Button>
      </CardContent>
    </Card>
  );
}
