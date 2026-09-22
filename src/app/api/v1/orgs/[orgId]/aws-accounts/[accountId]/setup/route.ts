import { orgRoute } from "@/server/http/route";
import { getSetupInstructions } from "@/server/services/connection-service";
import { accountParams } from "../params";

/** Reveals the ExternalId + generated templates. Restricted to roles that can connect accounts. */
export const GET = orgRoute({ operation: "aws_accounts.setup", permission: "aws_accounts:connect", params: accountParams }, async ({ access, params }) => ({
  setup: await getSetupInstructions(access, params.accountId),
}));
