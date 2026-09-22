"use client";
import { Button } from "@/components/ui/button";

export default function SecurityError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-3 rounded-lg border p-6">
    <h2 className="font-semibold">Security findings are unavailable</h2>
    <p className="text-sm text-muted-foreground">We could not load the latest findings. Please try again.</p>
    <Button onClick={reset} variant="outline">Try again</Button>
  </div>;
}
