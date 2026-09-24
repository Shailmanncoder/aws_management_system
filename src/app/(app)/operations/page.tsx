import type { Metadata } from "next";
import { OperationsHub, type HubData } from "@/components/operations/operations-hub";
import { getPageAccess } from "@/server/services/workspace-context";
import { getOperations } from "@/server/services/operations-service";
import { NoAccess } from "@/components/common/states";
export const metadata: Metadata = { title: "Operations" };
export default async function OperationsPage() {
  const { access, ctx } = await getPageAccess("org:read");
  if (!access) return <NoAccess what="operations" />;
  const data = await getOperations(access) as unknown as HubData;
  return <OperationsHub key={access.organizationId} data={data} orgId={access.organizationId} userId={ctx.user.id} role={ctx.role} />;
}
