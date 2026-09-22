import Link from "next/link";
import { SeverityBadge, type SeverityValue } from "@/components/findings/severity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ResourceFindings {
  security: { id: string; title: string; severity: string }[];
  optimization: { id: string; title: string }[];
  visible: boolean;
}

/** Open findings linked to a resource. Data is fetched (and permission-filtered) by the page. */
export function FindingsForResource({ findings }: { findings: ResourceFindings }) {
  if (!findings.visible) return null;
  const { security, optimization } = findings;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Findings for this resource</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {security.length === 0 && optimization.length === 0 && <p className="text-muted-foreground">No open findings.</p>}
        {security.map((f) => (
          <Link key={f.id} href={`/security/${f.id}`} className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted">
            <SeverityBadge severity={f.severity as SeverityValue} /> {f.title}
          </Link>
        ))}
        {optimization.map((f) => (
          <Link key={f.id} href={`/optimization/${f.id}`} className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Optimization</span> {f.title}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
