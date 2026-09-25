"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyBlock, CopyInline } from "@/components/common/copy-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const PLATFORM_USER_NAME = "stratus-platform";
const PLATFORM_ASSUME_ROLE_POLICY = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AssumeStratusRoles",
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Resource: ["arn:aws:iam::*:role/StratusReadOnlyRole", "arn:aws:iam::*:role/StratusActionRole"],
      },
    ],
  },
  null,
  2,
);

export function PlatformCredentialsForm({ orgId, initial, regions }: { orgId: string; initial: PlatformSetup; regions: string[] }) {
  const router = useRouter();
  const [setup, setSetup] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const endpoint = `/api/v1/orgs/${orgId}/platform-credentials`;
  const rejectedRootKey = error.toLowerCase().includes("root user credentials");

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
        <>
          <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-3 text-sm">
            <p className="font-medium">Stratus cannot talk to AWS yet.</p>
            <p className="mt-1">
              Live inventory and new AWS connections are paused. Complete the setup below; existing collected data remains available.
            </p>
          </div>

          <section className="space-y-4 rounded-lg border p-4" aria-labelledby="platform-setup-title">
            <div>
              <h3 id="platform-setup-title" className="font-semibold">What Stratus needs now</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A dedicated IAM user that can identify itself and assume only the Stratus roles. It does not need console access,
                AdministratorAccess, or AWS&apos;s broad ReadOnlyAccess policy.
              </p>
            </div>

            {rejectedRootKey && (
              <Alert variant="destructive">
                <AlertTitle>Replace the root access key first</AlertTitle>
                <AlertDescription>
                  In AWS, open your account menu → Security credentials → Access keys, then deactivate and delete the root key you tried here.
                  Never use a root key for Stratus.
                </AlertDescription>
              </Alert>
            )}

            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li className="space-y-2 pl-1">
                <p>In AWS IAM, create a user with this name and leave <strong>console access unchecked</strong>.</p>
                <CopyInline value={PLATFORM_USER_NAME} label="IAM user name" />
              </li>
              <li className="space-y-2 pl-1">
                <p>Create a customer-managed policy with the JSON below and attach it to that user.</p>
                <CopyBlock value={PLATFORM_ASSUME_ROLE_POLICY} label="platform assume-role policy" maxHeight="15rem" />
                <p className="text-xs text-muted-foreground">
                  This permits role assumption only. The separate role created by the Connect AWS wizard controls which metadata Stratus may read.
                </p>
              </li>
              <li className="pl-1">
                Open the user&apos;s <strong>Security credentials</strong>, create an access key, and choose <strong>Application running outside AWS</strong>.
              </li>
              <li className="pl-1">
                Paste the new access key and secret below, select the region you normally use, then choose <strong>Verify and save</strong>.
              </li>
            </ol>
          </section>
        </>
      )}

      {setup.configured && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm">
          <div>
            <p className="font-medium">Platform access is healthy.</p>
            <p className="text-muted-foreground">Next, connect an AWS account and let Stratus generate its restricted read-only role.</p>
          </div>
          <Button asChild size="sm">
            <Link href="/settings/cloud-accounts/connect">Connect AWS account</Link>
          </Button>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {setup.configured
            ? "Use this form only when rotating or replacing the platform IAM user's access key."
            : "Stratus verifies the IAM user with AWS before saving its credentials encrypted. Root user keys are always refused."}
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
          <Alert variant="destructive" role="alert">
            <AlertTitle>AWS access is not ready</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
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
          browser. The IAM user only needs permission to assume the restricted roles generated by Stratus.
        </p>
      </form>
    </div>
  );
}
