import { orgRoute } from "@/server/http/route";
import { budgetInput, getBudgets, saveBudget } from "@/server/services/simple-service";
export const GET = orgRoute({ operation: "budget.list", permission: "cost:read" }, async ({ access }) => ({ budgets: await getBudgets(access) }));
export const POST = orgRoute({ operation: "budget.save", permission: "alerts:manage", body: budgetInput, rateLimit: "api" }, async ({ access, body }) => saveBudget(access, body));
