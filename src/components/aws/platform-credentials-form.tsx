"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";

/**
 * Collects the platform's own AWS credentials so a running deployment can be finished from inside
 * the app rather than by editing environment variables and redeploying.
 *
 * The secret is posted once over HTTPS, verified against AWS, then stored encrypted. It is never
 * sent back to the browser, so the field always starts empty — there is nothing to pre-fill.
 */

export interface PlatformSetup {
  configured: boolean;
  source: "database" | "environment";
  awsAccountId: string | null;
  principalArn: string | null;
  region: string | null;
  verifiedAt: string | null;
}

export function PlatformCredentialsForm({ orgId, initial, regions }: { orgId: string; initial: PlatformSetup; regions: string[] }) {
  const router = useRouter();
  const [setup, setSetup] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const endpoint = `/api/v1/orgs/${orgId}/platform-credentials`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    const form = new FormData(e.currentTarget);
    try {
      const next = await api<PlatformSetup>(endpoint, {
        method: "PUT",
        body: {
          accessKeyId: String(form.get("accessKeyId") ?? "").trim(),
          secretAccessKey: String(form.get("secretAccessKey") ?? "").trim(),
          region: String(form.get("region") ?? ""),
        },
      });
      setSetup(next);
      setDone("Credentials verified with AWS and saved. Live AWS data is now enabled — no redeploy needed.");
      e.currentTarget.reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {setup.configured ? (
        <div className="rounded-md border border-status-good/40 bg-status-good/5 p-3 text-sm">
          <p className="font-medium">Stratus can talk to AWS.</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Identity</dt>
            <dd className="break-all font-mono text-xs">{setup.principalArn}</dd>
            <dt className="text-muted-foreground">AWS account</dt>
            <dd className="font-mono text-xs">{setup.awsAccountId}</dd>
            <dt className="text-muted-foreground">Region</dt>
            <dd className="font-mono text-xs">{setup.region}</dd>
            <dt className="text-muted-foreground">Verified</dt>
            <dd className="text-xs">{setup.verifiedAt ? new Date(setup.verifiedAt).toLocaleString() : "—"}</dd>
          </dl>
        </div>
      ) : (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-3 text-sm">
          <p className="font-medium">Stratus cannot talk to AWS yet.</p>
          <p className="mt-1">
            Until this is set, Stratus cannot read live data or connect new accounts. Anything already collected still shows, but it will not refresh.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Create an IAM user in your AWS account with read-only access, then paste its access key below. Stratus verifies the key with AWS before saving it, and
          stores it encrypted. Root user keys are refused.
        </p>

        <label className="block text-sm">
          Access key ID
          <Input name="accessKeyId" required autoComplete="off" spellCheck={false} placeholder="AKIA…" maxLength={20} />
        </label>

        <label className="block text-sm">
          Secret access key
          <Input name="secretAccessKey" type="password" required autoComplete="off" spellCheck={false} maxLength={256} />
        </label>

        <label className="block text-sm">
          Region
          <select name="region" className="w-full rounded-md border bg-background px-3 py-2 text-sm" defaultValue={setup.region ?? "us-east-1"}>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-status-good-text">
            {done}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Checking with AWS…" : setup.configured ? "Replace credentials" : "Verify and save"}
          </Button>
          {setup.configured && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                setDone("");
                void api<PlatformSetup>(endpoint, { method: "DELETE" })
                  .then((next) => {
                    setSetup(next);
                    setDone("Credentials removed. Stratus can no longer reach AWS.");
                    router.refresh();
                  })
                  .catch((err: unknown) => setError(errorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            >
              Remove
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          The secret is sent once over an encrypted connection, checked against AWS, then stored encrypted. It is never shown again and never sent back to your
          browser. Give the key the least access you can: Stratus only needs read permission plus the ability to assume the roles you connect.
        </p>
      </form>
    </div>
  );
}
