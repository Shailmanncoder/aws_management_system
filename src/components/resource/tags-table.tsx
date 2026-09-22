import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function TagsTable({ tags }: { tags: { key: string; value: string }[] }) {
  if (tags.length === 0) return <p className="text-sm text-muted-foreground">No tags.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Key</TableHead>
            <TableHead scope="col">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tags.map((t) => (
            <TableRow key={t.key}>
              <TableCell className="font-mono text-xs">{t.key}</TableCell>
              <TableCell className="break-all font-mono text-xs">{t.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
