import { orgRoute } from "@/server/http/route";
import { listAwsAccounts, startConnection, startConnectionInput } from "@/server/services/connection-service";

export const GET = orgRoute({ operation: "aws_accounts.list", permission: "aws_accounts:read" }, async ({ access }) => ({
  accounts: await listAwsAccounts(access),
}));

export const POST = orgRoute(
  { operation: "aws_accounts.start", permission: "aws_accounts:connect", body: startConnectionInput, rateLimit: "connectionValidate", rateLimitBy: "org" },
  async ({ access, body }) => ({ account: await startConnection(access, body) }),
);
