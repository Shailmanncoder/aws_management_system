import type { Metadata } from "next";
import { RuleManager } from "@/components/alerts/rule-manager";
import { NoAccess } from "@/components/common/states";
import { toClient } from "@/server/http/serialize";
import { listAlertRules } from "@/server/services/alert-service";
import { getPageAccess } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Alert rules" };

export default async function AlertRulesPage() {
  const { access } = await getPageAccess("alerts:read");
  if (!access) return <NoAccess what="alert rules" />;
  const rules = await listAlertRules(access);
  return <RuleManager orgId={access.organizationId} rules={toClient(rules)} canManage={access.can("alerts:manage")} />;
}
