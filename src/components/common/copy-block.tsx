"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied" : label}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}

/** Renders untrusted/long text as inert text inside <pre> (React escapes it). */
export function CopyBlock({ value, label, className, maxHeight = "20rem" }: { value: string; label?: string; className?: string; maxHeight?: string }) {
  return (
    <div className={cn("relative rounded-md border bg-muted/50", className)}>
      <div className="absolute right-1 top-1">
        <CopyButton value={value} label={label ? `Copy ${label}` : "Copy"} />
      </div>
      <pre className="overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed" style={{ maxHeight }} tabIndex={0} aria-label={label}>
        {value}
      </pre>
    </div>
  );
}

export function CopyInline({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </code>
      <CopyButton value={value} label={`Copy ${label}`} />
    </div>
  );
}
