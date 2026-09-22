import { orgRoute } from "@/server/http/route";
import { alertRuleInput, createAlertRule, listAlertRules, type AlertRuleInput } from "@/server/services/alert-service";

export const GET = orgRoute({ operation: "alert_rules.list", permission: "alerts:read" }, async ({ access }) => ({ rules: await listAlertRules(access) }));

export const POST = orgRoute({ operation: "alert_rules.create", permission: "alerts:manage", body: alertRuleInput, rateLimit: "api" }, async ({ access, body }) => ({
  rule: await createAlertRule(access, body as AlertRuleInput),
}));
