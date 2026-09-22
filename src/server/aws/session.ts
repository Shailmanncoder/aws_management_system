import { inspect } from "node:util";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@aws-sdk/types";

/**
 * An authenticated AWS session for ONE customer account.
 *
 * Credential-handling guarantees:
 *  - Credentials live in an ECMAScript private field (#credentials): they are not enumerable,
 *    not reachable via Object.keys / JSON.stringify / structuredClone / util.inspect.
 *  - `toJSON` and `util.inspect` return a redacted description, so accidental logging of the
 *    session object cannot leak key material.
 *  - Nothing in this class persists credentials; the object is dropped (GC) when the
 *    request/job that created it ends. `dispose()` clears the reference eagerly.
 *  - Temporary credentials are refreshed via the supplied `refresh` callback before expiry.
 */
export class AwsSession {
  readonly accountId: string;
  readonly partition: string;
  readonly kind: "assumed-role" | "access-key" | "fixture";
  readonly sessionName: string;
  #credentials: AwsCredentialIdentity | undefined;
  readonly #refresh?: () => Promise<AwsCredentialIdentity>;
  #inflight?: Promise<AwsCredentialIdentity>;

  constructor(init: {
    accountId: string;
    partition: string;
    kind: AwsSession["kind"];
    sessionName: string;
    credentials: AwsCredentialIdentity;
    refresh?: () => Promise<AwsCredentialIdentity>;
  }) {
    this.accountId = init.accountId;
    this.partition = init.partition;
    this.kind = init.kind;
    this.sessionName = init.sessionName;
    this.#credentials = init.credentials;
    this.#refresh = init.refresh;
  }

  /** Credential provider handed to SDK clients. Never exposes credentials to callers directly. */
  readonly credentialProvider: AwsCredentialIdentityProvider = async () => {
    const current = this.#credentials;
    if (!current) throw new Error("AWS session has been disposed");
    const expiresSoon = current.expiration && current.expiration.getTime() - Date.now() < 5 * 60 * 1000;
    if (expiresSoon && this.#refresh) {
      this.#inflight ??= this.#refresh().finally(() => {
        this.#inflight = undefined;
      });
      this.#credentials = await this.#inflight;
    }
    return this.#credentials as AwsCredentialIdentity;
  };

  get expiresAt(): Date | undefined {
    return this.#credentials?.expiration;
  }

  dispose(): void {
    this.#credentials = undefined;
  }

  toJSON() {
    return { accountId: this.accountId, kind: this.kind, sessionName: this.sessionName, credentials: "[REDACTED]" };
  }

  [inspect.custom]() {
    return `AwsSession(${this.kind}, account=${this.accountId}, credentials=[REDACTED])`;
  }
}
