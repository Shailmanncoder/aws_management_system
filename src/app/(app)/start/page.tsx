import { PageHeader } from "@/components/common/page-header";
import { NoAccess } from "@/components/common/states";
import { StartTask } from "@/components/simple/start";
import { getPageAccess } from "@/server/services/workspace-context";
export default async function StartPage() {
  const { access } = await getPageAccess("inventory:read"); if (!access) return <NoAccess what="guided tasks" />;
  return <div className="mx-auto max-w-4xl space-y-6"><PageHeader title="What would you like to do?" description="Start with your goal. See recommended settings, costs, and the effect of a change before following the steps." /><StartTask canReadSecurity={access.can("security:read")} /></div>;
}
