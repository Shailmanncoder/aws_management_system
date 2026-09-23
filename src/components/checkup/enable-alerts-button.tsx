"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

/**
 * The one thing on the check-up page Stratus can fix by itself: switching on the recommended
 * alerts. Everything else needs a change inside the customer's own AWS account, which Stratus
 * deliberately cannot make with a read-only role.
 */
export function EnableAlertsButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage("");
          void api<{ created: number }>(`/api/v1/orgs/${orgId}/alert-rules/recommended`, { body: {} })
            .then((r) => {
              setMessage(
                r.created > 0
                  ? `Done. ${r.created} alert${r.created === 1 ? "" : "s"} switched on. You can change them in settings whenever you like.`
                  : "They were already on, so nothing changed.",
              );
              router.refresh();
            })
            .catch((e: unknown) => setMessage(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Switching them on…" : "Switch alerts on for me"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
