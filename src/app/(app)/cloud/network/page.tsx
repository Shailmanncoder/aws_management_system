import { SectionActions } from "@/app/(app)/_components/section-actions";
import { CreateResource } from "@/components/aws/create-resource";
import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, NoAccess } from "@/components/common/states";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { StateBadge } from "@/components/data/state-badge";
import { TopologyView } from "@/components/network/topology-view";
import { TableShell } from "@/components/resource/table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describePorts, isWorldOpen } from "@/lib/network";
import {
  RESOURCE_TYPES,
  type ElasticIpAttrs,
  type LoadBalancerAttrs,
  type NatGatewayAttrs,
  type NetworkAclAttrs,
  type ResourceType,
  type RouteTableAttrs,
  type SecurityGroupAttrs,
  type SubnetAttrs,
  type VpcAttrs,
  type VpcEndpointAttrs,
} from "@/lib/resource-types";
import { buildHref, firstParam } from "@/lib/url";
import { cn } from "@/lib/utils";
import { listInventory, parseListParams, type ResourceDto } from "@/server/services/inventory-service";
import { getTopology } from "@/server/services/network-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Network" };

type View = "topology" | "vpcs" | "subnets" | "security-groups" | "route-tables" | "nacls" | "nat" | "eips" | "endpoints" | "load-balancers";

const VIEWS: { id: View; label: string; type?: ResourceType }[] = [
  { id: "topology", label: "Topology" },
  { id: "vpcs", label: "VPCs", type: RESOURCE_TYPES.VPC },
  { id: "subnets", label: "Subnets", type: RESOURCE_TYPES.SUBNET },
  { id: "security-groups", label: "Security groups", type: RESOURCE_TYPES.SECURITY_GROUP },
  { id: "route-tables", label: "Route tables", type: RESOURCE_TYPES.ROUTE_TABLE },
  { id: "nacls", label: "Network ACLs", type: RESOURCE_TYPES.NETWORK_ACL },
  { id: "nat", label: "NAT gateways", type: RESOURCE_TYPES.NAT_GATEWAY },
  { id: "eips", label: "Elastic IPs", type: RESOURCE_TYPES.ELASTIC_IP },
  { id: "endpoints", label: "VPC endpoints", type: RESOURCE_TYPES.VPC_ENDPOINT },
  { id: "load-balancers", label: "Load balancers", type: RESOURCE_TYPES.LOAD_BALANCER },
];

function columns(view: View): [string, (r: ResourceDto) => React.ReactNode][] {
  const mono = (s: unknown) => <span className="font-mono text-xs">{s === null || s === undefined || s === "" ? "—" : String(s)}</span>;
  switch (view) {
    case "vpcs":
      return [["CIDR", (r) => mono((r.attributes as unknown as VpcAttrs).cidr)], ["Default", (r) => ((r.attributes as unknown as VpcAttrs).isDefault ? "Yes" : "No")]];
    case "subnets":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as SubnetAttrs).vpcId)],
        ["CIDR", (r) => mono((r.attributes as unknown as SubnetAttrs).cidr)],
        ["AZ", (r) => (r.attributes as unknown as SubnetAttrs).availabilityZone],
        ["Auto-assign public IP", (r) => ((r.attributes as unknown as SubnetAttrs).mapPublicIpOnLaunch ? "Yes" : "No")],
      ];
    case "security-groups":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as SecurityGroupAttrs).vpcId)],
        ["Inbound rules", (r) => (r.attributes as unknown as SecurityGroupAttrs).ingress.length],
        [
          "Internet-open",
          (r) => {
            const open = (r.attributes as unknown as SecurityGroupAttrs).ingress.filter(isWorldOpen);
            return open.length ? (
              <span className="inline-flex items-center gap-1 text-xs">
                <AlertTriangle className="size-3.5 text-status-critical" aria-hidden />
                {open.map(describePorts).join(", ")}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            );
          },
        ],
      ];
    case "route-tables":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as RouteTableAttrs).vpcId)],
        ["Main", (r) => ((r.attributes as unknown as RouteTableAttrs).main ? "Yes" : "No")],
        ["Subnets", (r) => mono((r.attributes as unknown as RouteTableAttrs).subnetIds.join(", "))],
        ["Routes", (r) => <span className="font-mono text-xs">{(r.attributes as unknown as RouteTableAttrs).routes.map((x) => `${x.destination}→${x.target}`).join(", ")}</span>],
      ];
    case "nacls":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as NetworkAclAttrs).vpcId)],
        ["Default", (r) => ((r.attributes as unknown as NetworkAclAttrs).isDefault ? "Yes" : "No")],
        ["Subnets", (r) => (r.attributes as unknown as NetworkAclAttrs).subnetIds.length],
        ["Entries", (r) => (r.attributes as unknown as NetworkAclAttrs).entryCount],
      ];
    case "nat":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as NatGatewayAttrs).vpcId)],
        ["Subnet", (r) => mono((r.attributes as unknown as NatGatewayAttrs).subnetId)],
        ["Public IPs", (r) => mono((r.attributes as unknown as NatGatewayAttrs).publicIps.join(", "))],
      ];
    case "eips":
      return [
        ["Public IP", (r) => mono((r.attributes as unknown as ElasticIpAttrs).publicIp)],
        ["Associated instance", (r) => mono((r.attributes as unknown as ElasticIpAttrs).instanceId)],
      ];
    case "endpoints":
      return [
        ["VPC", (r) => mono((r.attributes as unknown as VpcEndpointAttrs).vpcId)],
        ["Service", (r) => mono((r.attributes as unknown as VpcEndpointAttrs).serviceName)],
        ["Type", (r) => (r.attributes as unknown as VpcEndpointAttrs).endpointType],
      ];
    case "load-balancers":
      return [
        ["Type", (r) => (r.attributes as unknown as LoadBalancerAttrs).lbType],
        ["Scheme", (r) => (r.attributes as unknown as LoadBalancerAttrs).scheme],
        ["DNS name", (r) => mono((r.attributes as unknown as LoadBalancerAttrs).dnsName)],
        ["VPC", (r) => mono((r.attributes as unknown as LoadBalancerAttrs).vpcId)],
      ];
    default:
      return [];
  }
}

export default async function NetworkPage({ searchParams }: PageProps<"/cloud/network">) {
  const { access } = await getPageAccess("inventory:read");
  if (!access) return <NoAccess what="network inventory" />;
  const raw = await searchParams;
  const viewParam = firstParam(raw.view) as View | undefined;
  const view: View = VIEWS.some((v) => v.id === viewParam) ? viewParam! : "topology";
  const params = parseListParams(raw);
  const path = "/cloud/network";

  return (
    <div className="space-y-4">
      <PageHeader title="Network explorer" actions={<SectionActions access={access} account={raw.account}>{access.can("provisioning:create") && (view === "vpcs" || view === "subnets") ? <CreateResource orgId={access.organizationId} service={view === "vpcs" ? "vpc" : "subnet"} /> : null}</SectionActions>} description="VPCs, subnets, routing and security groups. Topology relationships are derived only from AWS configuration." />
      <nav aria-label="Network views" className="-mx-1 flex gap-1 overflow-x-auto border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={buildHref(path, raw, { view: v.id === "topology" ? null : v.id, page: null })}
            aria-current={view === v.id ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground", view === v.id ? "border-primary font-medium text-foreground" : "border-transparent")}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "topology" ? <TopologySection access={access} params={params} /> : <TableSection access={access} view={view} raw={raw} params={params} path={path} />}
    </div>
  );
}

async function TopologySection({ access, params }: { access: Parameters<typeof getTopology>[0]; params: ReturnType<typeof parseListParams> }) {
  const topo = await getTopology(access, { accountRefIds: params.account ? [params.account] : undefined, regions: params.region ? [params.region] : undefined, vpcId: params.vpc });
  if (topo.regions.length === 0) return <EmptyState title="No VPCs in scope" description="Connect an account and sync, or widen the account/region scope." />;
  return (
    <>
      {params.vpc && (
        <p className="text-sm">
          Showing VPC <span className="font-mono">{params.vpc}</span> ·{" "}
          <Link className="text-primary hover:underline" href="/cloud/network">
            show all
          </Link>
        </p>
      )}
      {topo.truncated && <p className="text-sm text-muted-foreground">Large inventory: narrow the account/region scope to see the complete topology.</p>}
      <TopologyView regions={topo.regions} accountNames={topo.accountNames} />
    </>
  );
}

async function TableSection({ access, view, raw, params, path }: { access: Parameters<typeof listInventory>[0]; view: View; raw: Record<string, string | string[] | undefined>; params: ReturnType<typeof parseListParams>; path: string }) {
  const type = VIEWS.find((v) => v.id === view)!.type!;
  const data = await listInventory(access, [type], params);
  const cols = columns(view);
  return (
    <>
      <FilterBar />
      {data.total === 0 ? (
        <EmptyState title="Nothing found" description="No resources of this type match the current scope." />
      ) : (
        <>
          <TableShell caption={VIEWS.find((v) => v.id === view)!.label}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name / ID</TableHead>
                  <TableHead scope="col">State</TableHead>
                  <TableHead scope="col">Region</TableHead>
                  {cols.map(([h]) => (
                    <TableHead scope="col" key={h}>
                      {h}
                    </TableHead>
                  ))}
                  <TableHead scope="col">Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.name ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{r.resourceId}</div>
                    </TableCell>
                    <TableCell>
                      <StateBadge state={r.state} />
                    </TableCell>
                    <TableCell className="text-xs">{r.region}</TableCell>
                    {cols.map(([h, render]) => (
                      <TableCell key={h} className="text-sm">
                        {render(r)}
                      </TableCell>
                    ))}
                    <TableCell className="text-xs">{r.account.displayName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
          <Pagination pathname={path} params={raw} page={data.page} pageSize={data.pageSize} total={data.total} />
        </>
      )}
    </>
  );
}
