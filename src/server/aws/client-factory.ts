import "server-only";
import type { AwsCredentialIdentity, HandlerExecutionContext, MetadataBearer, MiddlewareStack } from "@smithy/types";
import { recordAwsCall } from "../observability/metrics";
import { classifyAwsError } from "./errors";
import { assertKnownRegion } from "./regions-catalog";
import { awsMode } from "./platform-credentials";
import type { AwsSession } from "./session";

/**
 * Creates AWS SDK v3 clients bound to a customer session.
 *
 *  - Region is validated against the known-region catalogue → endpoints are always genuine AWS
 *    endpoints (no user-controlled hostnames: SSRF-safe). Custom endpoints are never accepted.
 *  - Adaptive retry mode (client-side rate limiting + exponential backoff with jitter).
 *  - Connection/request timeouts so a hung endpoint cannot pin a worker.
 *  - A metrics middleware records latency, outcome class and throttles per service/operation.
 *  - In AWS_MODE=fixtures, a short-circuit middleware answers from deterministic fixtures
 *    before serialisation/signing, so all adapter logic (pagination, normalisation) still runs.
 */

// Minimal structural type shared by every generated SDK client.
interface SdkClient {
  middlewareStack: MiddlewareStack<object, MetadataBearer>;
  send: (...args: never[]) => Promise<unknown>;
}

export interface ClientConfigBase {
  useQueueUrlAsEndpoint?: boolean;
  region: string;
  credentials: AwsSession["credentialProvider"];
  maxAttempts: number;
  retryMode: "adaptive";
  requestHandler: { connectionTimeout: number; requestTimeout: number };
}

export function createAwsClient<C extends SdkClient>(
  Ctor: new (config: ClientConfigBase) => C,
  session: AwsSession,
  region: string,
  service: string,
  /** Service-specific safe options (never endpoints). */
  extra: { useQueueUrlAsEndpoint?: boolean; maxAttempts?: 1 } = {},
): C {
  assertKnownRegion(region);
  const client = new Ctor({
    ...extra,
    region,
    credentials: session.credentialProvider,
    maxAttempts: extra.maxAttempts ?? 5,
    retryMode: "adaptive",
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000 },
  });
  attachMiddleware(client, service, () => ({ accountId: session.accountId, region }));
  return client;
}

/** Platform-identity client (e.g. STS for AssumeRole) using the default provider chain. */
export function createPlatformClient<C extends SdkClient>(
  Ctor: new (config: Omit<ClientConfigBase, "credentials"> & { credentials?: AwsCredentialIdentity }) => C,
  region: string,
  service: string,
  /** Static credentials configured inside the app; omitted to use the SDK's own provider chain. */
  credentials?: AwsCredentialIdentity,
): C {
  assertKnownRegion(region);
  const client = new Ctor({
    region,
    ...(credentials ? { credentials } : {}),
    maxAttempts: 3,
    retryMode: "adaptive",
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 15_000 },
  });
  attachMiddleware(client, service, () => ({ accountId: undefined, region }));
  return client;
}

function attachMiddleware(client: SdkClient, service: string, scope: () => { accountId?: string; region: string }) {
  client.middlewareStack.add(
    (next, context: HandlerExecutionContext) => async (args) => {
      const started = performance.now();
      const op = context.commandName ?? "unknown";
      try {
        const res = await next(args);
        recordAwsCall(service, op, performance.now() - started, "ok");
        return res;
      } catch (err) {
        recordAwsCall(service, op, performance.now() - started, classifyAwsError(err));
        throw err;
      }
    },
    { step: "initialize", priority: "high", name: "stratusMetrics" },
  );

  if (awsMode() === "fixtures") {
    client.middlewareStack.add(
      (_next, context: HandlerExecutionContext) => async (args) => {
        const { accountId, region } = scope();
        // Loaded lazily: live deployments never load fixture code.
        const { resolveFixture } = await import("./fixtures/resolver");
        const output = await resolveFixture({
          service,
          command: context.commandName ?? "unknown",
          region,
          accountId,
          input: args.input as Record<string, unknown>,
        });
        return { output: { ...(output as object), $metadata: { httpStatusCode: 200 } } as MetadataBearer, response: {} };
      },
      { step: "initialize", priority: "low", name: "stratusFixtures" },
    );
  }
}
