"use client";

import { ArrowRight, Check, Download, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyBlock, CopyInline } from "@/components/common/copy-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api-client";
import type { AccountDto, SetupDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DiagnosticsTable } from "./diagnostics-table";
import { ConnectionStatusBadge } from "./connection-status";

type Step = 1 | 2 | 3 | 4;
const STEPS = ["Account", "Create role", "Verify", "Done"] as const;

export function ConnectWizard({ orgId, orgName, resume }: { orgId: string; orgName: string; resume?: AccountDto }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(resume ? 2 : 1);
  const [account, setAccount] = useState<AccountDto | null>(resume ?? null);
  const [setup, setSetup] = useState<SetupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (step !== 2 || !account || setup) return;
    api<{ setup: SetupDto }>(`/api/v1/orgs/${orgId}/aws-accounts/${account.id}/setup`)
      .then((r) => setSetup(r.setup))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [step, account, setup, orgId]);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ account: AccountDto }>(`/api/v1/orgs/${orgId}/aws-accounts`, {
        body: { awsAccountId: String(f.get("awsAccountId") ?? "").trim(), displayName: String(f.get("displayName") ?? "").trim() },
      });
      setAccount(r.account);
      setStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;
    setError(null);
    setPending(true);
    try {
      const roleArn = String(new FormData(e.currentTarget).get("roleArn") ?? "").trim();
      const r = await api<{ account: AccountDto }>(`/api/v1/orgs/${orgId}/aws-accounts/${account.id}/validate`, { body: { roleArn } });
      setAccount(r.account);
      const status = r.account.connection?.status;
      if (status === "CONNECTED" || status === "NEEDS_ATTENTION") {
        // Healthy connection: land on the Overview, which updates live as the first sync runs.
        router.push("/");
        router.refresh();
        return;
      }
      setStep(4);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Connection steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          const done = n < step;
          return (
            <li key={label} aria-current={n === step ? "step" : undefined} className={cn("flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm", n === step && "bg-muted font-medium")}>
              <span className={cn("grid size-6 place-items-center rounded-full border text-xs", done && "border-primary bg-primary text-primary-foreground")}>
                {done ? <Check className="size-3.5" aria-hidden /> : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="min-w-0 space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Which AWS account?</CardTitle>
              <CardDescription>
                Connecting to workspace <strong>{orgName}</strong>. Stratus will verify the role really belongs to this account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={start} className="grid max-w-md gap-4">
                <div className="space-y-2">
                  <Label htmlFor="awsAccountId">AWS account ID</Label>
                  <Input id="awsAccountId" name="awsAccountId" inputMode="numeric" pattern="\d{12}" maxLength={12} required placeholder="123456789012" className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input id="displayName" name="displayName" required maxLength={64} placeholder="Production" />
                </div>
                <Button type="submit" disabled={pending} className="w-fit">
                  Continue <ArrowRight aria-hidden />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 2 && account && (
          <Card>
            <CardHeader>
              <CardTitle>Create the read-only role in {account.awsAccountId}</CardTitle>
              <CardDescription>
                The role trusts only the Stratus principal and only when the unique ExternalId below is presented. It grants
                metadata read access and explicitly denies reading data, secrets and function code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!setup ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Generating setup…
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>External ID</Label>
                      <CopyInline value={setup.externalId} label="External ID" />
                      <p className="text-xs text-muted-foreground">Unique to this connection. Never reuse it elsewhere.</p>
                    </div>
                    <div className="space-y-1">
                      <Label>Trusted principal</Label>
                      <CopyInline value={setup.principalArn} label="trusted principal ARN" />
                    </div>
                  </div>
                  <Tabs defaultValue="cfn">
                    <TabsList>
                      <TabsTrigger value="cfn">CloudFormation (recommended)</TabsTrigger>
                      <TabsTrigger value="manual">Manual IAM</TabsTrigger>
                    </TabsList>
                    <TabsContent value="cfn" className="space-y-3 pt-3 text-sm">
                      <ol className="list-decimal space-y-1 pl-5">
                        <li>Download the template below.</li>
                        <li>
                          In account {account.awsAccountId}, open <em>CloudFormation → Create stack → With new resources</em> and upload it.
                        </li>
                        <li>Acknowledge IAM resource creation and create the stack.</li>
                        <li>Copy the <code>RoleArn</code> output and continue.</li>
                      </ol>
                      <Button asChild variant="outline" size="sm">
                        <a href={`/api/v1/orgs/${orgId}/aws-accounts/${account.id}/template`} download>
                          <Download aria-hidden /> Download template
                        </a>
                      </Button>
                      <CopyBlock value={setup.cloudFormationTemplate} label="CloudFormation template" maxHeight="16rem" />
                    </TabsContent>
                    <TabsContent value="manual" className="space-y-3 pt-3 text-sm">
                      <p>1. Trust policy (<code>stratus-trust-policy.json</code>):</p>
                      <CopyBlock value={JSON.stringify(setup.trustPolicy, null, 2)} label="trust policy" maxHeight="12rem" />
                      <p>2. Read-only permissions (<code>stratus-readonly-policy.json</code>):</p>
                      <CopyBlock value={JSON.stringify(setup.readOnlyPolicy, null, 2)} label="read-only policy" maxHeight="12rem" />
                      <p>3. Explicit data-plane deny (<code>stratus-deny-policy.json</code>):</p>
                      <CopyBlock value={JSON.stringify(setup.denyPolicy, null, 2)} label="deny policy" maxHeight="12rem" />
                      <p>4. Create the role with the AWS CLI:</p>
                      <CopyBlock value={setup.cliCommands.join("\n")} label="CLI commands" />
                    </TabsContent>
                  </Tabs>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => setStep(3)}>
                      I&apos;ve created the role <ArrowRight aria-hidden />
                    </Button>
                    <a className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html" target="_blank" rel="noopener noreferrer">
                      Why an ExternalId? <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {step === 3 && account && (
          <Card>
            <CardHeader>
              <CardTitle>Verify the connection</CardTitle>
              <CardDescription>
                Stratus will assume the role with the ExternalId, confirm the account via sts:GetCallerIdentity, discover enabled
                regions and check each permission. No credentials are stored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={verify} className="grid max-w-2xl gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roleArn">Role ARN</Label>
                  <Input
                    id="roleArn"
                    name="roleArn"
                    required
                    maxLength={2048}
                    className="font-mono text-xs"
                    defaultValue={account.connection?.roleArn ?? `arn:aws:iam::${account.awsAccountId}:role/StratusReadOnlyRole`}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden /> Verifying…
                      </>
                    ) : (
                      <>
                        <ShieldCheck aria-hidden /> Verify connection
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 4 && account?.connection && (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {account.displayName} <ConnectionStatusBadge status={account.connection.status} />
              </CardTitle>
              <CardDescription>{account.connection.statusMessage}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {account.connection.status === "CONNECTED" || account.connection.status === "NEEDS_ATTENTION" ? (
                <Alert>
                  <AlertTitle>Initial sync queued</AlertTitle>
                  <AlertDescription>
                    Inventory and cost data for {account.connection.enabledRegions.length} region(s) will appear as the background sync completes.
                  </AlertDescription>
                </Alert>
              ) : null}
              {account.connection.diagnostics && <DiagnosticsTable probes={account.connection.diagnostics.probes} />}
              <div className="flex gap-2">
                <Button asChild>
                  <Link href={`/settings/cloud-accounts/${account.id}`}>View account</Link>
                </Button>
                {account.connection.status !== "CONNECTED" && (
                  <Button variant="outline" onClick={() => setStep(3)}>
                    Re-verify
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
