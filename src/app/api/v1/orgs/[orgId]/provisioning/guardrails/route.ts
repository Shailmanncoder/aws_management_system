import { orgRoute } from "@/server/http/route";
import { updateGuardrails } from "@/server/aws/provisioning/service";
import { guardrailSchema } from "@/lib/provisioning";
export const PUT = orgRoute(
  {
    operation: "provisioning.updateGuardrails",
    permission: "provisioning:configure",
    rateLimit: "awsAction",
    rateLimitBy: "org",
    body: guardrailSchema,
  },
  async ({ access, body }) => updateGuardrails(access, body),
);
