import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_LABELS, WALKTHROUGHS, type WalkthroughCategory } from "@/lib/walkthroughs";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Guides" };

const ORDER: WalkthroughCategory[] = ["launch", "storage", "network", "remediate"];

const BLURBS: Record<WalkthroughCategory, string> = {
  launch: "Get a server running, configured the way you would want to find it later.",
  storage: "Buckets and databases that are private, encrypted and recoverable by default.",
  network: "The VPC, subnet and security group concepts, and how to set them up correctly.",
  remediate: "Step-by-step fixes for every finding Stratus reports, including what each change breaks.",
};

export default async function GuidesPage() {
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="guides" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guides"
        description="Click-by-click walkthroughs for doing things in the AWS console: where each screen is, what to enter, and why. Where your inventory is known, the steps name your own VPC, subnet and resource ids."
      />
      {ORDER.map((category) => {
        const items = WALKTHROUGHS.filter((w) => w.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h2>
              <p className="text-sm text-muted-foreground">{BLURBS[category]}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((w) => (
                <Card key={w.id} className="relative flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">
                      <Link href={`/guides/${w.id}`} className="after:absolute after:inset-0 hover:underline">
                        {w.title}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <p className="flex-1 text-sm text-muted-foreground">{w.summary}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden />
                        about {w.estimatedMinutes} min
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {w.steps.length} step{w.steps.length === 1 ? "" : "s"}
                      </span>
                      {w.fixesRuleIds?.map((r) => (
                        <Badge key={r} variant="outline" className="font-mono text-[0.65rem]">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-sm text-muted-foreground">
        These guides describe the AWS console, which AWS changes from time to time. Where a control has moved, the step text names what to search for as well as where it used to be. Stratus holds read-only
        credentials and never performs any of these changes on your behalf from this page.
      </p>
      <p className="text-sm">
        <Link href="/security" className="inline-flex items-center gap-1 text-primary hover:underline">
          See which of these apply to your account
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </p>
    </div>
  );
}
