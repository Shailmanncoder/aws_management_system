import { PageHeader } from "@/components/common/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getWorkspaceContext } from "@/server/services/workspace-context";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWorkspaceContext();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Settings" description={`Workspace “${ctx.org.name}”`} />
      <SettingsTabs role={ctx.role} />
      <div className="pt-5">{children}</div>
    </div>
  );
}
