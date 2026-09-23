import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { CloudDashboard } from "@/components/cloud/cloud-dashboard";
import { getPageAccess } from "@/server/services/workspace-context";
import { listCloudConnections } from "@/server/services/cloud-service";
export default async function ProviderPage({params}:PageProps<"/cloud/[provider]">) {
  const {provider}=await params;
  if(provider!=="gcp"&&provider!=="azure")notFound();
  const {ctx,access}=await getPageAccess("aws_accounts:read");
  if(!access)return <NoAccess what="cloud connections"/>;
  const name=provider==="gcp"?"Google Cloud":"Microsoft Azure",code=provider==="gcp"?"GCP":"AZURE";
  const connections=await listCloudConnections(access,code);
  return <div className="mx-auto max-w-6xl space-y-6"><PageHeader title={name} description={`${ctx.org.name} · Read-only resources, spending and security. These connections use their own scope; AWS filters do not apply.`}/><CloudDashboard key={ctx.org.id+provider} orgId={ctx.org.id} provider={code} connections={connections} canConnect={access.can("aws_accounts:connect")} canSync={access.can("sync:trigger")} canDisconnect={access.can("aws_accounts:disconnect")} canInventory={access.can("inventory:read")} canCost={access.can("cost:read")} canSecurity={access.can("security:read")}/></div>;
}
