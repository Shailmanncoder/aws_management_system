import { orgRoute } from "@/server/http/route";
import { accessKeyInput, connectWithAccessKey } from "@/server/services/connection-service";
import { accountParams } from "../params";

/** Development-only access-key mode (disabled unless ALLOW_ACCESS_KEY_CONNECTIONS=true). */
export const POST = orgRoute(
  {
    operation: "aws_accounts.access_key",
    permission: "aws_accounts:connect",
    params: accountParams,
    body: accessKeyInput,
    rateLimit: "connectionValidate",
    rateLimitBy: "org",
  },
  async ({ access, params, body }) => ({ account: await connectWithAccessKey(access, params.accountId, body) }),
);
