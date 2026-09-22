import type { Metadata } from "next";
import { formatDate } from "@/lib/format";
import { RESOURCE_TYPES, type EcrRepositoryAttrs, type EcsClusterAttrs, type EcsServiceAttrs, type EksClusterAttrs } from "@/lib/resource-types";
import { InventoryTablePage, Mono, Risk, yesNo } from "../../_components/inventory-table-page";

export const metadata: Metadata = { title: "Containers" };

export default async function ContainersPage({ searchParams }: PageProps<"/cloud/containers">) {
  return (
    <InventoryTablePage
      title="Containers"
      description="ECS clusters and services, EKS clusters and ECR repositories. Images are never pulled; task definitions (which may contain secrets) are never read."
      path="/cloud/containers"
      searchParams={await searchParams}
      tabs={[
        {
          type: RESOURCE_TYPES.ECS_CLUSTER,
          label: "ECS clusters",
          columns: [
            { header: "Services", cell: (r) => (r.attributes as unknown as EcsClusterAttrs).activeServices },
            { header: "Running tasks", cell: (r) => (r.attributes as unknown as EcsClusterAttrs).runningTasks },
            { header: "Pending tasks", cell: (r) => (r.attributes as unknown as EcsClusterAttrs).pendingTasks },
            { header: "Container instances", cell: (r) => (r.attributes as unknown as EcsClusterAttrs).containerInstances },
          ],
        },
        {
          type: RESOURCE_TYPES.ECS_SERVICE,
          label: "ECS services",
          columns: [
            { header: "Cluster", cell: (r) => (r.attributes as unknown as EcsServiceAttrs).clusterName },
            { header: "Launch type", cell: (r) => (r.attributes as unknown as EcsServiceAttrs).launchType },
            {
              header: "Tasks (running / desired)",
              cell: (r) => {
                const a = r.attributes as unknown as EcsServiceAttrs;
                return a.runningCount < a.desiredCount ? <Risk>{a.runningCount} / {a.desiredCount}</Risk> : `${a.runningCount} / ${a.desiredCount}`;
              },
            },
          ],
        },
        {
          type: RESOURCE_TYPES.EKS_CLUSTER,
          label: "EKS clusters",
          columns: [
            { header: "Version", cell: (r) => (r.attributes as unknown as EksClusterAttrs).version },
            { header: "Public endpoint", cell: (r) => yesNo((r.attributes as unknown as EksClusterAttrs).endpointPublicAccess, true) },
            { header: "Private endpoint", cell: (r) => yesNo((r.attributes as unknown as EksClusterAttrs).endpointPrivateAccess) },
            { header: "Public CIDRs", cell: (r) => <Mono>{(r.attributes as unknown as EksClusterAttrs).publicAccessCidrs.join(", ")}</Mono> },
            { header: "Created", cell: (r) => { const c = (r.attributes as unknown as EksClusterAttrs).createdAt; return c ? formatDate(c) : "—"; } },
          ],
        },
        {
          type: RESOURCE_TYPES.ECR_REPOSITORY,
          label: "ECR repositories",
          columns: [
            { header: "Images", cell: (r) => (r.attributes as unknown as EcrRepositoryAttrs).imageCount ?? "—" },
            { header: "Scan on push", cell: (r) => yesNo((r.attributes as unknown as EcrRepositoryAttrs).scanOnPush, false) },
            { header: "Tag mutability", cell: (r) => (r.attributes as unknown as EcrRepositoryAttrs).tagMutability },
            {
              header: "Latest scan",
              cell: (r) => {
                const s = (r.attributes as unknown as EcrRepositoryAttrs).latestScan;
                if (!s) return <span className="text-muted-foreground">No scan data</span>;
                return s.critical > 0 ? <Risk>{s.critical} critical, {s.high} high</Risk> : `${s.critical} critical, ${s.high} high`;
              },
            },
          ],
        },
      ]}
    />
  );
}
