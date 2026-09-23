"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { DEFAULT_GUARDRAILS, type Guardrails } from "@/lib/provisioning";
export function ProvisioningSetup({
  orgId,
  accountId,
}: {
  orgId: string;
  accountId: string;
}) {
  const base = `/api/v1/orgs/${orgId}/provisioning`,
    [setup, setSetup] = useState<{
      template: string;
      roleArn: string;
      enabled: boolean;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [guards, setGuards] = useState<Guardrails>(DEFAULT_GUARDRAILS),
    [loaded, setLoaded] = useState(false),
    [deployments, setDeployments] = useState<
      {
        id: string;
        status: string;
        review: { name: string; configuration: { accountId: string } };
      }[]
    >([]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <h2 className="font-semibold">Resource provisioning</h2>
      <p className="text-sm text-muted-foreground">
        Enable approved EC2 and private S3 creation with a separate
        StratusProvisionerRole. Deploy this as a new CloudFormation stack in
        this AWS account.
      </p>
      <Button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const o = await api<{ guardrails: Guardrails }>(`${base}/options`);
            setGuards(o.guardrails);
            setLoaded(true);
            setDeployments(await api(`${base}/plans`));
            setSetup(
              await api(`${base}/accounts/${accountId}/setup`, { body: {} }),
            );
          })
        }
      >
        Prepare provisioning upgrade
      </Button>
      {setup && (
        <>
          <p className="text-sm">
            Status: {setup.enabled ? "Enabled" : "Disabled"}
          </p>
          <p className="text-xs">Expected role: {setup.roleArn}</p>
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([setup.template], { type: "application/json" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "stratus-provisioner.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download CloudFormation template
          </Button>
          <p className="text-sm">
            Create a new stack using this template, acknowledge the named IAM
            role, wait for CREATE_COMPLETE, then validate and enable.
          </p>
          <p className="text-sm">
            <strong>Already deployed this stack?</strong> The template now also grants VPC and
            subnet creation. Download it again and update the existing stack, otherwise creating a
            network will fail with an AWS permission error. Nothing else changes, and updating
            grants no deletion, routing or gateway permissions.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`${base}/accounts/${accountId}/enable`, {
                    body: { enabled: true },
                  });
                  setSetup({ ...setup, enabled: true });
                  setMessage(
                    "Provisioning enabled. Each resource still requires a reviewed plan and explicit confirmation.",
                  );
                })
              }
            >
              Validate and enable
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() =>
                run(async () => {
                  await api(`${base}/accounts/${accountId}/enable`, {
                    body: { enabled: false },
                  });
                  setSetup({ ...setup, enabled: false });
                })
              }
            >
              Disable provisioning
            </Button>
          </div>
        </>
      )}
      {loaded && (
        <details>
          <summary>Workspace provisioning guardrails</summary>
          <form
            className="space-y-3 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`${base}/guardrails`, {
                  method: "PUT",
                  body: guards,
                });
                setMessage(
                  "Guardrails saved. Download a fresh template and update the provisioning stack if IAM limits changed.",
                );
              });
            }}
          >
            <label className="block text-sm">
              Allowed regions (comma-separated)
              <Input
                value={guards.allowedRegions.join(",")}
                onChange={(e) =>
                  setGuards({
                    ...guards,
                    allowedRegions: e.target.value
                      .split(",")
                      .map((s) => s.trim()),
                  })
                }
              />
            </label>
            <label className="block text-sm">
              Maximum instances per connected account
              <Input
                type="number"
                min={1}
                max={100}
                value={guards.maxInstances}
                onChange={(e) =>
                  setGuards({ ...guards, maxInstances: Number(e.target.value) })
                }
              />
            </label>
            <label className="block text-sm">
              Maximum storage per instance (GiB)
              <Input
                type="number"
                min={8}
                max={1000}
                value={guards.maxStorageGiB}
                onChange={(e) =>
                  setGuards({
                    ...guards,
                    maxStorageGiB: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={guards.allowPublicIpv4}
                onChange={(e) =>
                  setGuards({ ...guards, allowPublicIpv4: e.target.checked })
                }
              />
              Allow reviewed public IPv4 requests
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm">Allowed instance types</legend>
              {(["t3.micro", "t3.small", "t4g.micro"] as const).map((t) => (
                <label key={t} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={guards.allowedInstanceTypes.includes(t)}
                    onChange={(e) =>
                      setGuards({
                        ...guards,
                        allowedInstanceTypes: e.target.checked
                          ? [...guards.allowedInstanceTypes, t]
                          : guards.allowedInstanceTypes.filter((v) => v !== t),
                      })
                    }
                  />
                  {t}
                </label>
              ))}
            </fieldset>
            <p className="text-xs">
              Encryption is required. Public S3 buckets remain prohibited.
            </p>
            <Button disabled={busy} type="submit">
              Save guardrails
            </Button>
          </form>
        </details>
      )}
      {deployments
        .filter(
          (p) =>
            p.review.configuration.accountId === accountId &&
            ["UNKNOWN", "APPLYING"].includes(p.status),
        )
        .map((p) => (
          <div key={p.id} className="space-y-2 text-sm">
            <p>
              {p.review.name}: {p.status}
            </p>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() =>
                run(async () => {
                  await api(`${base}/plans/${p.id}/reconcile`, { body: {} });
                  setDeployments(await api(`${base}/plans`));
                  setMessage("Deployment verified and inventory updated.");
                })
              }
            >
              Reconcile deployment
            </Button>
            <p className="text-xs">
              This checks AWS without creating or deleting resources. Repair
              incomplete configuration in AWS first.
            </p>
          </div>
        ))}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
