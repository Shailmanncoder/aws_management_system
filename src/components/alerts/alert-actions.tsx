"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

export function AlertActions({ orgId, alertId, status }: { orgId: string; alertId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const set = async (next: "ACKNOWLEDGED" | "RESOLVED") => {
    setBusy(true);
    try {
      await api(`/api/v1/orgs/${orgId}/alerts/${alertId}`, { method: "PATCH", body: { status: next } });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2">
      {status === "OPEN" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void set("ACKNOWLEDGED")}>Acknowledge</Button>}
      {status !== "RESOLVED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void set("RESOLVED")}>Resolve</Button>}
    </div>
  );
}
