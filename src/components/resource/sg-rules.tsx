import { AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describePorts, isWorldOpen, ruleCoversPort, SENSITIVE_PORTS } from "@/lib/network";
import type { SecurityGroupRule } from "@/lib/resource-types";

export function SecurityGroupRules({ rules }: { rules: SecurityGroupRule[] }) {
  if (rules.length === 0) return <p className="text-sm text-muted-foreground">No inbound rules.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Protocol / ports</TableHead>
            <TableHead scope="col">Sources</TableHead>
            <TableHead scope="col">Exposure</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r, i) => {
            const world = isWorldOpen(r);
            const sensitive = world ? Object.entries(SENSITIVE_PORTS).filter(([p]) => ruleCoversPort(r, Number(p))).map(([, n]) => n) : [];
            return (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{describePorts(r)}</TableCell>
                <TableCell className="font-mono text-xs">{r.sources.map((s) => s.value).join(", ") || "—"}</TableCell>
                <TableCell className="text-sm">
                  {world ? (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="size-3.5 text-status-critical" aria-hidden />
                      Internet{sensitive.length ? ` · ${sensitive.slice(0, 4).join(", ")}${sensitive.length > 4 ? "…" : ""}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Restricted</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
