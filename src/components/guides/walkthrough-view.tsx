import { Explain } from "@/components/simple/explain";
import { AlertTriangle, ArrowUpRight, Check, Info, MapPin, Undo2 } from "lucide-react";
import { CopyBlock, CopyInline } from "@/components/common/copy-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { consoleServiceLabel, consoleUrl, resolveTokens, type Walkthrough, type WalkthroughContext, type WalkthroughStep } from "@/lib/walkthroughs";

/**
 * Renders a walkthrough as numbered steps. Presentational only: every `{{token}}` is resolved
 * against the caller-supplied context here, and console links are built by the allow-listed
 * `consoleUrl` builder, so nothing in this file constructs a URL from free text.
 */

export function WalkthroughView({ walkthrough, ctx }: { walkthrough: Walkthrough; ctx: WalkthroughContext }) {
  const t = (s: string) => resolveTokens(s, ctx);
  return (
    <div className="space-y-4">
      <Explain label="Before making this change">
        <p><strong>Expected result:</strong> {t(walkthrough.summary)}</p>
        <p><strong>Possible disruption:</strong> {walkthrough.steps.filter(s => s.warning).map(s => t(s.warning!)).join(" ") || "Check which applications depend on these settings before changing them. Downtime depends on your setup."}</p>
        <p><strong>Undo or recover:</strong> {walkthrough.rollback ? t(walkthrough.rollback) : "No automatic undo is available. Record existing settings and back up data before making changes."}</p>
        <p>Follow the cost and verification steps below. Opening this guide does not make changes in AWS.</p>
      </Explain>
      {walkthrough.prerequisites && walkthrough.prerequisites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {walkthrough.prerequisites.map((p) => (
                <li key={p}>{t(p)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {walkthrough.cost && (
        <Card>
          <CardHeader>
            <CardTitle>What this costs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{t(walkthrough.cost)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Prices are indicative list prices for orientation, not a quote. Your invoice depends on your region, usage, discounts and taxes.
            </p>
          </CardContent>
        </Card>
      )}

      <ol className="space-y-4">
        {walkthrough.steps.map((step, i) => (
          <Step key={step.title} step={step} index={i + 1} ctx={ctx} />
        ))}
      </ol>

      {walkthrough.verify && walkthrough.verify.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="size-4 text-status-good" aria-hidden />
              How to check it worked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {walkthrough.verify.map((v) => (
                <li key={v}>{t(v)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {walkthrough.rollback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Undo2 className="size-4" aria-hidden />
              How to undo it
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{t(walkthrough.rollback)}</CardContent>
        </Card>
      )}

      {walkthrough.cli && (
        <Card>
          <CardHeader>
            <CardTitle>Same thing from the command line</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t(walkthrough.cli.description)}</p>
            <CopyBlock value={walkthrough.cli.commands.map(t).join("\n\n")} label="CLI commands" />
            <p className="text-xs text-muted-foreground">
              These run with whatever credentials your CLI profile uses — not with the read-only role Stratus holds. Check which account you are in with{" "}
              <code className="font-mono">aws sts get-caller-identity</code> first.
            </p>
          </CardContent>
        </Card>
      )}

      {walkthrough.docs && walkthrough.docs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AWS documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {walkthrough.docs.map((d) => (
                <li key={d.url}>
                  <a className="inline-flex items-center gap-1 text-primary hover:underline" href={d.url} target="_blank" rel="noreferrer noopener">
                    {d.label}
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Step({ step, index, ctx }: { step: WalkthroughStep; index: number; ctx: WalkthroughContext }) {
  const t = (s: string) => resolveTokens(s, ctx);
  const region = ctx.region;
  const target = step.target;
  // The target's resource may itself be a token (the finding's resource id), so resolve first.
  const link = target && region ? consoleUrl({ ...target, resource: target.resource ? t(target.resource) : undefined }, region) : null;

  return (
    <li>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
              {index}
            </span>
            <span>
              <span className="sr-only">Step {index}: </span>
              {t(step.title)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {step.where && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">Where to find it: </span>
              {step.where.map((crumb, i) => (
                <span key={crumb} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>{"›"}</span>}
                  <span className="font-medium text-foreground">{t(crumb)}</span>
                </span>
              ))}
            </p>
          )}

          {link && (
            <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={link} target="_blank" rel="noreferrer noopener">
              Open {consoleServiceLabel(target!.service)} in the AWS console ({region})
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          )}

          <ol className="list-decimal space-y-1.5 pl-5">
            {step.actions.map((a) => (
              <li key={a}>{t(a)}</li>
            ))}
          </ol>

          {step.fields && step.fields.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to enter</p>
              <dl className="space-y-2.5">
                {step.fields.map((f) => (
                  <div key={f.label} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-sm font-medium">{t(f.label)}</dt>
                    <dd className="space-y-1">
                      <CopyInline value={t(f.value)} label={f.label} />
                      <p className="text-xs text-muted-foreground">{t(f.why)}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {step.warning && (
            <p className="flex gap-2 rounded-md border border-status-critical/40 bg-status-critical/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-critical" aria-hidden />
              <span>
                <span className="sr-only">Warning: </span>
                {t(step.warning)}
              </span>
            </p>
          )}

          {step.note && (
            <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t(step.note)}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export function ContextSummary({ ctx }: { ctx: WalkthroughContext }) {
  const items: [string, string | undefined][] = [
    ["Region", ctx.region],
    ["VPC", ctx.vpcId],
    ["Subnet", ctx.subnetId],
    ["Security group", ctx.securityGroupId],
  ];
  const known = items.filter(([, v]) => v);
  if (known.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        These steps use placeholders because no synced inventory was found for this workspace yet. Connect an AWS account and run a sync, and the steps below will name your own VPC and subnet ids.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filled in from your inventory:</span>
      {known.map(([label, value]) => (
        <Badge key={label} variant="outline" className="font-mono text-xs">
          {label}: {value}
        </Badge>
      ))}
    </div>
  );
}
