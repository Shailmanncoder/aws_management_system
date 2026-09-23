import { PageHeader } from "@/components/common/page-header";
import { Projects } from "@/components/simple/projects";
import { getPageAccess } from "@/server/services/workspace-context";
import { getProjects } from "@/server/services/simple-service";
import { Explain } from "@/components/simple/explain";
export default async function ProjectsPage() {
  const { access } = await getPageAccess("org:read"); if (!access) return null;
  const data = await getProjects(access);
  return <div className="mx-auto max-w-5xl space-y-6"><PageHeader title="Business projects" description="See accounts by what they support and who looks after them. This page covers the whole workspace." /><Projects orgId={access.organizationId} projects={data.projects} accounts={data.accounts} canManage={access.can("org:update")} canReadCosts={access.can("cost:read")} canReadResources={access.can("inventory:read")} /><Explain><p>Project costs add the reported usage spending from assigned accounts, separately for each currency. Resource-level billing is not collected, so a shared AWS account cannot be split accurately between projects here.</p><p>Spending may be delayed or incomplete. Check the Spending page for billing coverage and invoices. Project names and owners are labels in Stratus; they do not change AWS tags or permissions.</p></Explain></div>;
}
