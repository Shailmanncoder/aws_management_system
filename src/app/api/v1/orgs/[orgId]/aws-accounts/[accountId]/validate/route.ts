import { orgRoute } from "@/server/http/route";
import { validateConnection, validateConnectionInput } from "@/server/services/connection-service";
import { accountParams } from "../params";

export const POST = orgRoute(
  {
    operation: "aws_accounts.validate",
    permission: "aws_accounts:connect",
    params: accountParams,
    body: validateConnectionInput,
    rateLimit: "connectionValidate",
    rateLimitBy: "org",
  },
  async ({ access, params, body }) => ({ account: await validateConnection(access, params.accountId, body) }),
);
