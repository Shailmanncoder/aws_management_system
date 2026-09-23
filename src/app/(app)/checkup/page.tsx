import { AlertTriangle, ArrowRight, BookOpen, Check, CircleHelp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { EnableAlertsButton } from "@/components/checkup/enable-alerts-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { URGENCY_LABELS, URGENCY_ORDER, type CheckUrgency } from "@/lib/checkup";
import { cn } from "@/lib/utils";
import { getCheckup, type CheckResult } from "@/server/services/checkup-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Check-up" };

const HEADINGS: Record<CheckUrgency, { title: string; blurb: string }> = {
  now: { title: "Do this now", blurb: "These leave your data or your money exposed today." },
  soon: { title: "Do this soon", blurb: "Not on fire, but they will bite eventually." },
  whenever: { title: "Worth doing", blurb: "Tidying up that makes everything easier later." },
  done: { title: "Already sorted", blurb: "Checked, and nothing to do here." },
};

const TONE: Record<CheckUrgency, string> = {
  now: "border-status-critical/40 bg-status-critical/5",
  soon: "border-status-warning/40 bg-status-warning/5",
  whenever: "",
  done: "",
};

export default async function CheckupPage() {
  const { ctx, access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="the account check-up" />;
  const { results, counts, nothingExaminedYet } = await getCheckup(access);

  const todo = counts.now + counts.soon + counts.whenever;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account check-up"
        description="What is missing or unsafe in your cloud account, in plain English. No jargon, and every item says what it means and what to do about it."
      />

      <Card>
        <CardContent className="py-5">
          {todo === 0 ? (
            <p className="text-base">
              <strong>Nothing needs your attention.</strong> Every check Stratus can make came back clean. Come back after anything changes in your account.
            </p>
          ) : (
            <p className="text-base">
              <strong>
                {todo} thing{todo === 1 ? "" : "s"} to look at.
              </strong>{" "}
              {counts.now > 0 ? `${counts.now} of them should be done today. ` : ""}
              Start at the top — the list is already in order of how much it matters.
            </p>
          )}
          {nothingExaminedYet && (
            <p className="mt-3 flex gap-2 rounded-md bg-muted/60 p-3 text-sm">
              <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Stratus has not finished looking inside your account yet, so the safety checks below are marked &ldquo;not checked yet&rdquo; rather than
                &ldquo;fine&rdquo;. We will not tell you something is safe when we have not looked.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {URGENCY_ORDER.map((urgency) => {
        const group = results.filter((r) => r.urgency === urgency);
        if (group.length === 0) return null;
        return (
          <section key={urgency} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{HEADINGS[urgency].title}</h2>
              <p className="text-sm text-muted-foreground">{HEADINGS[urgency].blurb}</p>
            </div>
            <div className="space-y-3">
              {group.map((item) => (
                <CheckCard key={item.id} item={item} orgId={access.organizationId} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-sm text-muted-foreground">
        Signed in as {ctx.user.email}. This check-up only looks at the accounts connected to this workspace, and Stratus can only read them — it cannot change
        anything in your cloud account by itself.
      </p>
    </div>
  );
}

function CheckCard({ item, orgId }: { item: CheckResult; orgId: string }) {
  if (item.ok) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <Check className="mt-0.5 size-5 shrink-0 text-status-good" aria-hidden />
          <div>
            <p className="font-medium">{item.goodNews}</p>
            {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(TONE[item.urgency])}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {item.urgency === "now" ? (
            <AlertTriangle className="size-4 shrink-0 text-status-critical" aria-hidden />
          ) : null}
          {item.title}
          <Badge variant="outline" className="font-normal">
            {item.unknown ? "Not checked yet" : URGENCY_LABELS[item.urgency]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {item.detail && <p className="font-medium">{item.detail}</p>}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What this means</p>
          <p>{item.meaning}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why it matters</p>
          <p>{item.whyItMatters}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to do</p>
          <p>{item.whatToDo}</p>
        </div>

        {item.unknown ? (
          <p className="text-sm text-muted-foreground">Press Refresh on any page to let Stratus look, then come back.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {item.fixKind === "stratus-can-do-it" && <EnableAlertsButton orgId={orgId} />}
            {item.guideId && (
              <Link href={`/guides/${item.guideId}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                <BookOpen className="size-4" aria-hidden />
                Show me exactly where to click
              </Link>
            )}
            {item.href && (
              <Link href={item.href} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                {item.linkLabel ?? "Open"}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
