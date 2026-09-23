import { orgRoute } from "@/server/http/route";
import {
  clearPlatformCredentials,
  getPlatformSetup,
  platformCredentialsInput,
  savePlatformCredentials,
} from "@/server/services/platform-setup-service";

/**
 * Platform AWS credentials. `permission: "org:update"` is the coarse gate; the service applies the
 * real rule (Owner of the installing workspace, single-workspace deployments only).
 * Responses contain metadata only — the secret is never returned.
 */
export const GET = orgRoute({ operation: "platform.credentials_get", permission: "org:update" }, async ({ access }) =>
  getPlatformSetup(access),
);

export const PUT = orgRoute(
  { operation: "platform.credentials_set", permission: "org:update", rateLimit: "connectionValidate", body: platformCredentialsInput },
  async ({ access, body }) => savePlatformCredentials(access, body),
);

export const DELETE = orgRoute(
  { operation: "platform.credentials_clear", permission: "org:update", rateLimit: "connectionValidate" },
  async ({ access }) => clearPlatformCredentials(access),
);
