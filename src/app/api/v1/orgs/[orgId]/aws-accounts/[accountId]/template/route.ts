import { orgRoute } from "@/server/http/route";
import { getSetupInstructions } from "@/server/services/connection-service";
import { accountParams } from "../params";

/** CloudFormation template download (attachment, never cached). */
export const GET = orgRoute({ operation: "aws_accounts.template", permission: "aws_accounts:connect", params: accountParams }, async ({ access, params }) => {
  const setup = await getSetupInstructions(access, params.accountId);
  return new Response(setup.cloudFormationTemplate, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="stratus-readonly-role-${setup.awsAccountId}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
