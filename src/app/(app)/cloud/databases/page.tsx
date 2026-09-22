import type { Metadata } from "next";
import { formatBytes, formatNumber } from "@/lib/format";
import { RESOURCE_TYPES, type DynamoTableAttrs, type RdsClusterAttrs, type RdsInstanceAttrs } from "@/lib/resource-types";
import { InventoryTablePage, Mono, Risk, yesNo } from "../../_components/inventory-table-page";

export const metadata: Metadata = { title: "Databases" };

const rds = (a: unknown) => a as RdsInstanceAttrs;

export default async function DatabasesPage({ searchParams }: PageProps<"/cloud/databases">) {
  return (
    <InventoryTablePage
      title="Databases"
      description="RDS instances, Aurora clusters and DynamoDB tables. Credentials, master usernames and item data are never read or stored."
      path="/cloud/databases"
      searchParams={await searchParams}
      tabs={[
        {
          type: RESOURCE_TYPES.RDS_INSTANCE,
          label: "RDS instances",
          columns: [
            { header: "Engine", cell: (r) => `${rds(r.attributes).engine} ${rds(r.attributes).engineVersion ?? ""}` },
            { header: "Class", cell: (r) => <Mono>{rds(r.attributes).instanceClass}</Mono> },
            { header: "Storage", cell: (r) => (rds(r.attributes).allocatedStorageGiB ? `${rds(r.attributes).allocatedStorageGiB} GiB` : "—") },
            { header: "Encrypted", cell: (r) => yesNo(rds(r.attributes).encrypted, false) },
            { header: "Public", cell: (r) => yesNo(rds(r.attributes).publiclyAccessible, true) },
            { header: "Multi-AZ", cell: (r) => yesNo(rds(r.attributes).multiAz) },
            { header: "Backups", cell: (r) => (rds(r.attributes).backupRetentionDays === 0 ? <Risk>Disabled</Risk> : `${rds(r.attributes).backupRetentionDays} days`) },
            { header: "VPC", cell: (r) => <Mono>{rds(r.attributes).vpcId}</Mono> },
          ],
        },
        {
          type: RESOURCE_TYPES.RDS_CLUSTER,
          label: "Aurora clusters",
          columns: [
            { header: "Engine", cell: (r) => `${(r.attributes as unknown as RdsClusterAttrs).engine} ${(r.attributes as unknown as RdsClusterAttrs).engineVersion ?? ""}` },
            { header: "Mode", cell: (r) => (r.attributes as unknown as RdsClusterAttrs).engineMode },
            { header: "Encrypted", cell: (r) => yesNo((r.attributes as unknown as RdsClusterAttrs).encrypted, false) },
            { header: "Members", cell: (r) => (r.attributes as unknown as RdsClusterAttrs).memberIds.join(", ") },
          ],
        },
        {
          type: RESOURCE_TYPES.DYNAMODB_TABLE,
          label: "DynamoDB",
          columns: [
            { header: "Capacity", cell: (r) => { const a = r.attributes as unknown as DynamoTableAttrs; return a.billingMode === "PAY_PER_REQUEST" ? "On-demand" : `Provisioned ${a.readCapacity ?? 0} RCU / ${a.writeCapacity ?? 0} WCU`; } },
            { header: "Items", cell: (r) => { const a = r.attributes as unknown as DynamoTableAttrs; return a.itemCount === null ? "—" : formatNumber(a.itemCount, { compact: true }); } },
            { header: "Size", cell: (r) => { const a = r.attributes as unknown as DynamoTableAttrs; return a.sizeBytes === null ? "—" : formatBytes(a.sizeBytes); } },
            { header: "Encryption", cell: (r) => (r.attributes as unknown as DynamoTableAttrs).sseType },
            { header: "PITR backups", cell: (r) => { const p = (r.attributes as unknown as DynamoTableAttrs).pointInTimeRecovery; return !p.ok ? "unknown" : p.value ? "Enabled" : <Risk>Disabled</Risk>; } },
          ],
        },
      ]}
    />
  );
}
