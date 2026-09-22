import { orgRoute } from "@/server/http/route";
import { enableRecommendedRules } from "@/server/services/alert-service";

export const POST = orgRoute({ operation: "alert_rules.recommended", permission: "alerts:manage", rateLimit: "api" }, async ({ access }) => ({
  created: await enableRecommendedRules(access),
}));
