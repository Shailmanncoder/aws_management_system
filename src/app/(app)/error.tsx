"use client";
import { Button } from "@/components/ui/button";
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="mx-auto max-w-xl space-y-4 rounded-xl border bg-card p-6" role="alert"><h1 className="text-xl font-semibold">We couldn’t load this page</h1><p className="text-sm text-muted-foreground">Some information is temporarily unavailable. Try again in a moment. If it keeps happening, ask your workspace administrator to check the connection.</p><Button onClick={reset}>Try again</Button></section>;
}
