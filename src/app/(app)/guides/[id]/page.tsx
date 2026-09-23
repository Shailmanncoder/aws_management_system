import { Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { ContextSummary, WalkthroughView } from "@/components/guides/walkthrough-view";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, getWalkthrough } from "@/lib/walkthroughs";
import { firstParam } from "@/lib/url";
import { getWalkthroughContext } from "@/server/services/walkthrough-service";
import { getPageAccess } from "@/server/services/workspace-context";

export async function generateMetadata({ params }: PageProps<"/guides/[id]">): Promise<Metadata> {
  const { id } = await params;
  const w = getWalkthrough(id);
  return { title: w ? w.title : "Guide" };
}

export default async function GuidePage({ params, searchParams }: PageProps<"/guides/[id]">) {
  const { id } = await params;
  const walkthrough = getWalkthrough(id);
  if (!walkthrough) notFound();

  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="guides" />;

  const raw = await searchParams;
  const ctx = await getWalkthroughContext(access, {
    region: firstParam(raw.region),
    resourceId: firstParam(raw.resource),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/guides" className="hover:underline">
            Guides
          </Link>
        }
        title={walkthrough.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{CATEGORY_LABELS[walkthrough.category]}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              about {walkthrough.estimatedMinutes} min
            </span>
            {walkthrough.fixesRuleIds?.map((r) => (
              <Badge key={r} variant="outline" className="font-mono text-[0.65rem]">
                fixes {r}
              </Badge>
            ))}
          </span>
        }
      />
      <p className="max-w-3xl text-sm">{walkthrough.summary}</p>
      <ContextSummary ctx={ctx} />
      <WalkthroughView walkthrough={walkthrough} ctx={ctx} />
    </div>
  );
}
