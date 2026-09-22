import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Plain download link: the server enforces auth, tenant scope, permission and rate limits. */
export function ExportButton({ orgId, report, query = {}, label = "Export CSV" }: { orgId: string; report: "inventory" | "cost" | "security" | "optimization" | "audit"; query?: Record<string, string | undefined>; label?: string }) {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && e[0] !== "page"));
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`/api/v1/orgs/${orgId}/exports/${report}${qs.toString() ? `?${qs}` : ""}`} download>
        <Download aria-hidden /> {label}
      </a>
    </Button>
  );
}
