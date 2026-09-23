"use client";

import { Globe, Server } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all__";

/** Global AWS account + region scope, carried in the URL (?account=&region=) across pages. */
export function ScopeFilter({ accounts, regions }: { accounts: { id: string; label: string }[]; regions: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (accounts.length === 0 || ["/cloud/gcp", "/cloud/azure"].includes(pathname)) return null;

  const set = (key: "account" | "region", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <Select value={params.get("account") ?? ALL} onValueChange={(v) => set("account", v)}>
        <SelectTrigger className="h-8 w-auto max-w-48" aria-label="AWS account scope">
          <Server className="size-3.5 opacity-60" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("region") ?? ALL} onValueChange={(v) => set("region", v)}>
        <SelectTrigger className="h-8 w-auto" aria-label="AWS region scope">
          <Globe className="size-3.5 opacity-60" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All regions</SelectItem>
          {regions.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
