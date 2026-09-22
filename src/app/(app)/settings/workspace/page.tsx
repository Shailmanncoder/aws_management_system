import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoAccess } from "@/components/common/states";
import { ROLE_LABELS } from "@/lib/rbac";
import { getOrganization } from "@/server/services/organization-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage() {
  const { access } = await getPageAccess("org:read");
  if (!access) return <NoAccess />;
  const org = await getOrganization(access);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Identifiers are useful when contacting support.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{org.name}</dd>
            <dt className="text-muted-foreground">Workspace ID</dt>
            <dd className="font-mono text-xs break-all">{org.id}</dd>
            <dt className="text-muted-foreground">Your role</dt>
            <dd>{ROLE_LABELS[access.role]}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{org.createdAt.toLocaleDateString()}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Operational actions</CardTitle>
          <CardDescription>Starting, stopping or rebooting resources from Stratus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Status: <strong>{org.actionModeEnabled ? "Enabled" : "Disabled (read-only)"}</strong>
          </p>
          <p className="text-muted-foreground">
            Stratus is read-only by default. Action mode requires deploying a separate, narrowly scoped action role in each
            AWS account and can only be enabled by a workspace owner. See docs/IAM.md.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
