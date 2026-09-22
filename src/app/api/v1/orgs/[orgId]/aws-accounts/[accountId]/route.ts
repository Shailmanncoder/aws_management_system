import { orgRoute } from "@/server/http/route";
import { disconnectAccount, getAwsAccount, regionAllowlistInput, setRegionAllowlist } from "@/server/services/connection-service";
import { accountParams } from "./params";

export const GET = orgRoute({ operation: "aws_accounts.get", permission: "aws_accounts:read", params: accountParams }, async ({ access, params }) => ({
  account: await getAwsAccount(access, params.accountId),
}));

export const PATCH = orgRoute(
  { operation: "aws_accounts.regions", permission: "aws_accounts:connect", params: accountParams, body: regionAllowlistInput, rateLimit: "api" },
  async ({ access, params, body }) => ({ account: await setRegionAllowlist(access, params.accountId, body.regionAllowlist) }),
);

export const DELETE = orgRoute(
  { operation: "aws_accounts.disconnect", permission: "aws_accounts:disconnect", params: accountParams, rateLimit: "api" },
  async ({ access, params }) => {
    await disconnectAccount(access, params.accountId);
    return { ok: true };
  },
);
