"use client";
import { ChangePreview } from "@/components/simple/change-preview";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import {
  configurationSchema,
  type Guardrails,
  type Review,
} from "@/lib/provisioning";

type Options = {
  network: {
    accountId: string;
    region: string;
    id: string;
    name: string;
    type: string;
  }[];
  guardrails: Guardrails;
  accounts: {
    id: string;
    name: string;
    awsAccountId: string;
    regions: string[];
    bucketPrefix: string;
  }[];
};
type Plan = {
  id: string;
  status: string;
  configurationHash: string;
  review: Review;
  expiresAt: string;
  resourceId: string | null;
  resultMessage: string | null;
};
const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export type ServiceKind = "ec2" | "s3" | "vpc" | "subnet";

const LABELS: Record<ServiceKind, { short: string; long: string }> = {
  ec2: { short: "instance", long: "EC2 instance" },
  s3: { short: "bucket", long: "S3 bucket" },
  vpc: { short: "VPC", long: "VPC" },
  subnet: { short: "subnet", long: "subnet" },
};
/** Per-service form fields. Everything is re-validated by configurationSchema and again server-side. */
function serviceFields(
  service: ServiceKind,
  f: FormData,
  get: (k: string) => string,
): Record<string, unknown> {
  switch (service) {
    case "ec2":
      return {
        architecture: get("instanceType").startsWith("t4g") ? "arm64" : "x86_64",
        instanceType: get("instanceType"),
        vpcId: get("vpcId"),
        subnetId: get("subnetId"),
        securityGroupIds: get("securityGroupIds")
          .split(",")
          .map((s) => s.trim()),
        storageGiB: Number(get("storageGiB")),
        publicIpv4: f.get("publicIpv4") === "on",
        ...(get("keyName") ? { keyName: get("keyName") } : {}),
      };
    case "s3":
      return { versioning: f.get("versioning") === "on" };
    case "vpc":
      return { cidr: get("cidr"), enableDnsHostnames: f.get("enableDnsHostnames") === "on" };
    case "subnet":
      return {
        vpcId: get("vpcId"),
        cidr: get("cidr"),
        ...(get("availabilityZone") ? { availabilityZone: get("availabilityZone") } : {}),
      };
  }
}

export function CreateResource({
  orgId,
  service,
}: {
  orgId: string;
  service: ServiceKind;
}) {
  const router = useRouter(),
    base = `/api/v1/orgs/${orgId}/provisioning`;
  const [options, setOptions] = useState<Options | null>(null),
    [accountId, setAccountId] = useState("");
  const [history, setHistory] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(""),
    [exposure, setExposure] = useState(false),
    [requestKey, setRequestKey] = useState<string | null>(null);
  const account = options?.accounts.find((a) => a.id === accountId);
  async function load() {
    setBusy(true);
    try {
      const o = await api<Options>(`${base}/options`);
      setOptions(o);
      setAccountId(o.accounts[0]?.id ?? "");
      setHistory(await api<Plan[]>(`${base}/plans`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      const get = (k: string) => String(f.get(k) ?? "");
      const configuration = configurationSchema.parse({
        service,
        accountId,
        region: get("region"),
        name: get("name"),
        environment: get("environment"),
        tags: get("tags").trim()
          ? get("tags")
              .trim()
              .split("\n")
              .map((line) => {
                const i = line.indexOf("=");
                if (i < 1) throw new Error("Each tag must use key=value.");
                return {
                  key: line.slice(0, i).trim(),
                  value: line.slice(i + 1).trim(),
                };
              })
          : [],
        ...serviceFields(service, f, get),
      });
      const key = requestKey ?? crypto.randomUUID();
      setRequestKey(key);
      setPlan(
        await api<Plan>(`${base}/plans`, {
          body: { idempotencyKey: key, configuration },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Plan>(`${base}/plans/${plan.id}/apply`, {
        body: {
          configurationHash: plan.configurationHash,
          confirmation: confirm,
          acknowledgeExposure: exposure,
        },
      });
      setPlan(p);
      router.refresh();
    } catch (e) {
      setError(`${errorMessage(e)} Check deployment status before retrying.`);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!plan) return;
    setBusy(true);
    try {
      setPlan(await api<Plan>(`${base}/plans/${plan.id}`));
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          onClick={() => {
            void load();
          }}
        >
          + Create {LABELS[service].short}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Create {LABELS[service].long}
          </DialogTitle>
          <DialogDescription>
            Configure, review, then confirm creation in your AWS account.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!plan && options?.accounts.length === 0 && (
          <p>
            An administrator must enable provisioning under Settings → Cloud
            accounts first.
          </p>
        )}
        {!plan && history.length > 0 && (
          <details>
            <summary>Recent deployments</summary>
            {history.map((p) => (
              <Button key={p.id} variant="ghost" onClick={() => setPlan(p)}>
                {p.review.name} · {p.status}
              </Button>
            ))}
          </details>
        )}
        {!plan && account && (
          <form
            onSubmit={submit}
            onChange={() => setRequestKey(null)}
            className="space-y-4"
          >
            <label className="block text-sm">
              AWS account
              <select
                className={control}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {options?.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.awsAccountId})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Name
              <Input
                name="name"
                required
                maxLength={63}
                key={accountId}
                defaultValue={service === "s3" ? account.bucketPrefix : ""}
              />
            </label>
            {service === "s3" && (
              <p className="text-xs text-muted-foreground">
                Use the connection prefix {account.bucketPrefix}. Public access
                stays blocked, ACLs disabled, and encryption enabled.
              </p>
            )}
            <label className="block text-sm">
              Region
              <select name="region" className={control}>
                {account.regions
                  .filter((r) => options!.guardrails.allowedRegions.includes(r))
                  .map((r) => (
                    <option key={r}>{r}</option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              Environment
              <select name="environment" className={control}>
                {["development", "staging", "production"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {service === "ec2" ? (
              <>
                <p className="text-sm">
                  Amazon Linux 2023 · encrypted gp3 storage · required IMDSv2.
                  Architecture is selected to match the instance type.
                </p>
                <label className="block text-sm">
                  Instance type
                  <select name="instanceType" className={control}>
                    {options?.guardrails.allowedInstanceTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Storage (GiB)
                  <Input
                    type="number"
                    name="storageGiB"
                    min={8}
                    max={options?.guardrails.maxStorageGiB}
                    defaultValue={8}
                    required
                  />
                </label>
                {[
                  ["provision-vpcs", "ec2:vpc"],
                  ["provision-subnets", "ec2:subnet"],
                  ["provision-groups", "ec2:security-group"],
                ].map(([id, type]) => (
                  <datalist id={id} key={id}>
                    {options?.network
                      .filter(
                        (n) => n.accountId === accountId && n.type === type,
                      )
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} · {n.region}
                        </option>
                      ))}
                  </datalist>
                ))}
                <label className="block text-sm">
                  VPC ID
                  <Input
                    list="provision-vpcs"
                    name="vpcId"
                    placeholder="vpc-…"
                    required
                  />
                </label>
                <label className="block text-sm">
                  Subnet ID
                  <Input
                    list="provision-subnets"
                    name="subnetId"
                    placeholder="subnet-…"
                    required
                  />
                </label>
                <label className="block text-sm">
                  Security group IDs, separated by commas
                  <Input
                    list="provision-groups"
                    name="securityGroupIds"
                    placeholder="sg-…"
                    required
                  />
                </label>
              </>
            ) : service === "s3" ? (
              <label className="flex gap-2 text-sm">
                <input name="versioning" type="checkbox" defaultChecked />
                Enable versioning
              </label>
            ) : service === "vpc" ? (
              <>
                <label className="block text-sm">
                  IPv4 CIDR block
                  <Input name="cidr" required defaultValue="10.0.0.0/16" placeholder="10.0.0.0/16" />
                </label>
                <p className="text-xs text-muted-foreground">
                  Use a private range (10.x, 172.16-31.x or 192.168.x), /16 to /28. This cannot be
                  changed after creation, and it must not overlap any network you may later peer
                  with or connect by VPN.
                </p>
                <label className="flex gap-2 text-sm">
                  <input name="enableDnsHostnames" type="checkbox" defaultChecked />
                  Enable DNS hostnames (needed for most AWS service integrations)
                </label>
                <p className="text-xs text-muted-foreground">
                  No internet gateway, NAT gateway or route to the internet is created. The VPC is
                  private until you add those yourself.
                </p>
              </>
            ) : (
              <>
                <label className="block text-sm">
                  VPC
                  <select name="vpcId" className={control} required>
                    {options?.network
                      .filter((n) => n.type === "ec2:vpc" && n.accountId === accountId)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} ({n.id}) · {n.region}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  Only VPCs from synced inventory are listed. Pick one in the region selected above.
                </p>
                <label className="block text-sm">
                  IPv4 CIDR block
                  <Input name="cidr" required defaultValue="10.0.1.0/24" placeholder="10.0.1.0/24" />
                </label>
                <p className="text-xs text-muted-foreground">
                  Must sit inside the VPC&apos;s range and not overlap an existing subnet. AWS
                  reserves 5 addresses; a /24 leaves 251 usable. The range cannot be resized later.
                </p>
                <label className="block text-sm">
                  Availability Zone (optional)
                  <Input name="availabilityZone" placeholder="Leave blank to let AWS choose" />
                </label>
                <p className="text-xs text-muted-foreground">
                  Left blank, Stratus picks a zone the VPC is not using yet, so a multi-zone layout
                  happens by default. Auto-assign public IPv4 is always disabled.
                </p>
              </>
            )}
            <details>
              <summary className="cursor-pointer text-sm">
                Advanced settings
              </summary>
              <div className="space-y-3 pt-3">
                {service === "ec2" && (
                  <>
                    <label className="block text-sm">
                      Existing key pair (optional)
                      <Input name="keyName" />
                    </label>
                    <label className="flex gap-2 text-sm">
                      <input
                        name="publicIpv4"
                        type="checkbox"
                        disabled={!options?.guardrails.allowPublicIpv4}
                      />
                      Request public IPv4 (requires workspace permission and
                      review)
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Instance profiles are not enabled in this release. No IAM
                      role will be attached.
                    </p>
                  </>
                )}
                <label className="block text-sm">
                  Tags, one key=value per line
                  <textarea
                    name="tags"
                    className={control}
                    placeholder="team=platform"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Do not enter personal information, credentials or secrets in
                  names or tags.
                </p>
              </div>
            </details>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking configuration…" : "Create review plan"}
            </Button>
          </form>
        )}
        {plan && (
          <div className="space-y-4">
            <p className="font-medium">
              {plan.status === "PLANNED"
                ? "Review deployment"
                : `Deployment: ${plan.status}`}
            </p>
            <ChangePreview review={plan.review} />
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Name</dt>
              <dd>{plan.review.name}</dd>
              <dt>Region</dt>
              <dd>{plan.review.region}</dd>
              <dt>Network exposure</dt>
              <dd>{plan.review.networkExposure}</dd>
              <dt>Estimated cost</dt>
              <dd>
                {plan.review.estimatedMonthlyUsd === null
                  ? "Unavailable"
                  : `USD ${plan.review.estimatedMonthlyUsd.toFixed(2)}/month`}
              </dd>
              {plan.review.imageId && (
                <>
                  <dt>AMI</dt>
                  <dd>{plan.review.imageId}</dd>
                  <dt>Compute</dt>
                  <dd>
                    {plan.review.vcpu} vCPU · {plan.review.memoryMiB} MiB
                  </dd>
                </>
              )}
            </dl>
            <details open>
              <summary>Configuration and tags</summary>
              <dl className="grid grid-cols-2 gap-2 rounded bg-muted p-3 text-sm">
                <dt>Account</dt>
                <dd>
                  {options?.accounts.find(
                    (a) => a.id === plan.review.configuration.accountId,
                  )?.name ?? "Selected AWS account"}
                </dd>
                <dt>Environment</dt>
                <dd>{plan.review.configuration.environment}</dd>
                {plan.review.configuration.service === "vpc" ? (
                  <>
                    <dt>IPv4 CIDR</dt>
                    <dd className="break-all">{plan.review.configuration.cidr}</dd>
                    <dt>DNS hostnames</dt>
                    <dd>{plan.review.configuration.enableDnsHostnames ? "Enabled" : "Disabled"}</dd>
                    <dt>Internet gateway</dt>
                    <dd>Not created</dd>
                  </>
                ) : plan.review.configuration.service === "subnet" ? (
                  <>
                    <dt>VPC</dt>
                    <dd className="break-all">{plan.review.configuration.vpcId}</dd>
                    <dt>IPv4 CIDR</dt>
                    <dd className="break-all">{plan.review.configuration.cidr}</dd>
                    <dt>Availability Zone</dt>
                    <dd>{plan.review.availabilityZone ?? "Chosen by AWS"}</dd>
                    <dt>Usable addresses</dt>
                    <dd>{plan.review.usableAddresses ?? "Unknown"}</dd>
                    <dt>Auto-assign public IPv4</dt>
                    <dd>Disabled</dd>
                  </>
                ) : plan.review.configuration.service === "s3" ? (
                  <>
                    <dt>Encryption</dt>
                    <dd>Enabled (SSE-S3)</dd>
                    <dt>Versioning</dt>
                    <dd>
                      {plan.review.configuration.versioning
                        ? "Enabled"
                        : "Disabled"}
                    </dd>
                    <dt>Public access</dt>
                    <dd>Blocked</dd>
                    <dt>Access control lists</dt>
                    <dd>Disabled</dd>
                  </>
                ) : (
                  <>
                    <dt>Operating system</dt>
                    <dd>Amazon Linux 2023</dd>
                    <dt>Instance type</dt>
                    <dd>{plan.review.configuration.instanceType}</dd>
                    <dt>Architecture</dt>
                    <dd>{plan.review.configuration.architecture}</dd>
                    <dt>Storage</dt>
                    <dd>
                      {plan.review.configuration.storageGiB} GiB, encrypted gp3
                    </dd>
                    <dt>VPC</dt>
                    <dd className="break-all">
                      {plan.review.configuration.vpcId}
                    </dd>
                    <dt>Subnet</dt>
                    <dd className="break-all">
                      {plan.review.configuration.subnetId}
                    </dd>
                    <dt>Security groups</dt>
                    <dd className="break-all">
                      {plan.review.configuration.securityGroupIds.join(", ")}
                    </dd>
                    <dt>Key pair</dt>
                    <dd>{plan.review.configuration.keyName ?? "None"}</dd>
                    <dt>Instance profile</dt>
                    <dd>None</dd>
                  </>
                )}
              </dl>
              <details className="mt-2 text-sm">
                <summary>Resource tags</summary>
                <dl className="mt-2 grid grid-cols-2 gap-2">
                  {Object.entries(plan.review.tags).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt>{key}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </details>
            <p className="text-xs">
              Required permissions: {plan.review.requiredPermissions.join(", ")}
            </p>
            {plan.review.warnings.map((w) => (
              <p key={w} className="text-sm">
                {w}
              </p>
            ))}
            {plan.status === "PLANNED" ? (
              <>
                <p className="text-xs">
                  Expires {new Date(plan.expiresAt).toLocaleString()}
                </p>
                <label className="block text-sm">
                  Type {plan.review.name} to confirm
                  <Input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                {plan.review.configuration.service === "ec2" &&
                  plan.review.configuration.publicIpv4 && (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={exposure}
                        onChange={(e) => setExposure(e.target.checked)}
                      />
                      I understand this requests public network exposure.
                    </label>
                  )}
                <div className="flex gap-2">
                  <Button
                    disabled={busy || confirm !== plan.review.name}
                    onClick={apply}
                  >
                    {busy ? "Deploying and verifying…" : "Confirm and create"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPlan(null);
                      setRequestKey(null);
                      setConfirm("");
                    }}
                  >
                    Edit configuration
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p role="status">
                  {plan.resultMessage ??
                    "Deployment is processing. Refresh to check its status."}
                </p>
                {plan.resourceId && (
                  <p className="font-mono text-sm">{plan.resourceId}</p>
                )}
              </>
            )}
            {["SUCCEEDED", "FAILED"].includes(plan.status) && (
              <Button
                disabled={busy}
                onClick={() => {
                  setPlan(null);
                  setRequestKey(null);
                  setConfirm("");
                  setExposure(false);
                }}
              >
                Create another resource
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={refresh}>
              Refresh deployment status
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
