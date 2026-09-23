import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return <div aria-busy="true" aria-label="Loading your workspace" className="mx-auto max-w-6xl space-y-5"><Skeleton className="h-36 rounded-xl" /><div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-56 rounded-xl" /></div><p className="text-sm text-muted-foreground">Loading your workspace…</p></div>;
}
