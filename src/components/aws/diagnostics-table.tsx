import { CheckCircle2, CircleSlash, ShieldAlert, XCircle } from "lucide-react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProbeResultDto } from "@/lib/types";

const STATUS = {
  OK: { icon: CheckCircle2, label: "OK", cls: "text-success-text" },
  DENIED: { icon: ShieldAlert, label: "Permission denied", cls: "text-status-critical" },
  NOT_ENABLED: { icon: CircleSlash, label: "Not enabled", cls: "text-muted-foreground" },
  ERROR: { icon: XCircle, label: "Error", cls: "text-status-serious" },
} as const;

export function DiagnosticsTable({ probes }: { probes: ProbeResultDto[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableCaption className="sr-only">Permission diagnostics per capability</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Capability</TableHead>
            <TableHead scope="col">IAM action</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {probes.map((p) => {
            const s = STATUS[p.status];
            const Icon = s.icon;
            return (
              <TableRow key={`${p.capability}:${p.iamAction}`}>
                <TableCell>
                  {p.label} {p.required && <span className="text-xs text-muted-foreground">(required)</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.iamAction}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1 text-sm ${s.cls}`}>
                    <Icon className="size-4" aria-hidden /> {s.label}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.message ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
