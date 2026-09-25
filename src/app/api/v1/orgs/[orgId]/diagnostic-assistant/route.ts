import { orgRoute } from "@/server/http/route";
import {
  askDiagnosticAssistant,
  diagnosticQuestionInput,
  getDiagnosticAssistant,
} from "@/server/services/diagnostic-assistant-service";

export const GET = orgRoute(
  { operation: "diagnostic-assistant.read", permission: "org:read" },
  async ({ access }) => getDiagnosticAssistant(access),
);

export const POST = orgRoute(
  { operation: "diagnostic-assistant.ask", permission: "org:read", body: diagnosticQuestionInput, bodyLimitBytes: 2_000_000, rateLimit: "api" },
  async ({ access, body }) => askDiagnosticAssistant(access, body),
);
