# Threat model

Scope: the Stratus web tier (Next.js), worker, PostgreSQL, key management, and the cross-account
IAM roles in customer AWS accounts. Method: STRIDE-style analysis per asset and entry point.

**Primary assets:** customer AWS access (the ability to assume customer roles), per-connection
ExternalIds, optional access-key secrets, tenant inventory/cost/security data, user sessions,
the audit trail.

**Trust boundaries:** browser ↔ web tier; web/worker ↔ PostgreSQL; web/worker ↔ KMS;
worker/web ↔ customer AWS (via STS); platform account ↔ customer accounts.

Each entry lists *attack scenario*, *affected component*, *preventive controls*, *detective
controls* and *remaining risk*. "Tested" references automated tests in `tests/`.

---

## 1. Credential theft (AWS credentials)

- **Scenario:** attacker obtains STS credentials or stored access keys from the database, logs,
  a memory dump, an API response or the browser.
- **Component:** `src/server/aws/*`, DB, logs, API.
- **Preventive:** role-based onboarding (no long-term keys); temporary STS credentials only ever
  live in an `AwsSession` private field, never serialised (`toJSON`/`inspect` redact); sessions are
  disposed after each job/request; nothing credential-shaped is persisted. Access-key mode is off by
  default and, when enabled, keys are envelope-encrypted (AES-256-GCM, KMS-wrapped data key, AAD
  bound to tenant+row). Root credentials rejected. The platform refuses to start with root
  credentials. Log redaction removes access-key ids, secrets, session tokens, JWTs, cookies, URL
  passwords and PEM keys.
- **Detective:** tests scan the entire database, API responses and logs for credential markers
  after connection and sync (`aws-connection`, `sync-engine`, `redact`, `logger`, `aws-sts`).
  CloudTrail in the customer account shows every `AssumeRole` with session name `stratus-*`.
- **Remaining risk:** a fully compromised worker/web host can use its platform role to assume any
  customer role whose ExternalId it can decrypt, for the lifetime of the compromise. Mitigate with
  host hardening, least-privilege KMS policies, short-lived compute and alerting on unusual
  AssumeRole volume.

## 2. Tenant isolation failure

- **Scenario:** a bug lets organisation A read or change organisation B's data.
- **Component:** repositories, services, cache.
- **Preventive:** every tenant table has `organizationId`; every query filters by the
  `OrgAccess.organizationId` produced by the central guard (never user input); composite foreign
  keys `(organizationId, awsAccountRefId)` make cross-tenant rows impossible at the DB level; cache
  keys always contain the org id and data version (built only by the cache module).
- **Detective:** cross-tenant tests on every resource type and API (`auth-and-tenancy`,
  `aws-connection`, `inventory-api`, `cost`, `optimization`, `alerts-search-audit`,
  `live-and-adversarial`).
- **Remaining risk:** new code paths that bypass repositories. Mitigated by review and the
  repository/guard conventions; consider PostgreSQL row-level security as a second layer.

## 3. IDOR

- **Scenario:** attacker changes a resource/member/finding id in a URL.
- **Component:** API routes, pages.
- **Preventive:** ids are UUID-validated; lookups are always `(organizationId, id)`; foreign ids
  return 404 identical to non-existent ids; updates use `updateMany` with the org filter.
- **Detective:** explicit IDOR tests for members, accounts, resources, metrics, findings, alerts.
- **Remaining risk:** low.

## 4. SSRF

- **Scenario:** attacker makes the server fetch `169.254.169.254` or an internal service.
- **Component:** AWS client factory, alert delivery.
- **Preventive:** no generic fetch endpoints; AWS endpoints derive only from a validated region
  in a known-region allow-list (no custom endpoints); SQS clients never use response-provided queue
  URLs as endpoints; S3 Control host uses the DB-stored 12-digit account id; outbound webhooks are
  deliberately not implemented (require an egress proxy + allow-list first).
- **Detective:** region/ARN validation tests.
- **Remaining risk:** future integrations (webhooks, Slack) must go through an egress proxy.

## 5. XSS

- **Scenario:** AWS-controlled strings (tags, names) or user input render as HTML/JS.
- **Component:** UI.
- **Preventive:** React escaping; no `dangerouslySetInnerHTML` (CI gate); strict nonce-based CSP
  with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`; input validation rejects
  angle brackets in names.
- **Detective:** E2E renders a fixture tag `<img onerror>` and asserts it is inert; CSP violations
  fail E2E.
- **Remaining risk:** `style-src 'unsafe-inline'` (required by Radix/Recharts inline styles) allows
  CSS injection if markup injection were ever possible.

## 6. CSRF

- **Scenario:** a malicious site triggers state changes with the victim's cookies.
- **Preventive:** SameSite=Lax httpOnly cookies; Origin must equal `APP_URL` for non-GET API
  requests; JSON-only bodies (form posts rejected); Better Auth origin checks.
- **Detective:** integration + E2E CSRF tests.
- **Remaining risk:** low; same-site subdomain compromise would bypass SameSite.

## 7. SQL injection

- **Preventive:** Prisma parameterised queries; raw SQL only via tagged templates / `Prisma.sql`;
  facet keys are allow-listed; search terms validated.
- **Detective:** injection payload tests (org names, search, filters, ids).
- **Remaining risk:** low.

## 8. Session theft

- **Scenario:** stolen session cookie reused.
- **Preventive:** httpOnly, SameSite=Lax, Secure in production, HSTS; DB-backed sessions (no cookie
  cache) so revocation is immediate; 12h absolute expiry; TOTP MFA available; auth rate limits.
- **Detective:** login audit events with IP/user agent.
- **Remaining risk:** malware on the user's device; MFA enforcement per workspace is on the roadmap.

## 9. AWS role abuse (confused deputy / account substitution)

- **Scenario:** tenant B registers tenant A's role ARN; or a tenant points Stratus at the platform's
  own account.
- **Preventive:** a unique 256-bit ExternalId per connection, generated by Stratus and never
  chosen by users; the role ARN's account must equal the declared account and `GetCallerIdentity`
  must match again; connecting the platform's own account is refused (single-account self-hosting
  opt-in `ALLOW_PLATFORM_ACCOUNT_CONNECTION` is rejected in production).
- **Detective:** tests for substitution, wrong/missing ExternalId, platform account; audit of every
  connection attempt.
- **Remaining risk:** customers who reuse an ExternalId elsewhere weaken their own protection.

## 10. Privilege escalation

- **Preventive:** central RBAC matrix; admins cannot grant Owner/Admin; users cannot change their
  own role; last-owner protection; server-side checks only.
- **Detective:** escalation tests; audit of role changes.
- **Remaining risk:** low.

## 11. Supply-chain compromise

- **Preventive:** lockfile + exact versions; npm install-script allow-listing (only 4 packages may
  run scripts); `npm audit` gate; Dependabot; Trivy image scan; minimal dependencies (in-house logger,
  concurrency, CSV).
- **Detective:** CI gates; gitleaks secret scanning.
- **Remaining risk:** a malicious release of a trusted package between audits.

## 12. Dependency compromise (runtime)

- **Preventive:** server-only boundary (`server-only`, lint rule) keeps AWS SDK/Prisma out of browser
  bundles; production image contains production dependencies only and runs as non-root.
- **Remaining risk:** a compromised AWS SDK/Prisma package runs with platform privileges.

## 13. Log leakage

- **Preventive:** every log field passes through recursive redaction (keys + value patterns);
  control characters stripped (log-injection safe); stack traces omitted in production; AWS error
  messages not propagated to users.
- **Detective:** redaction/logger tests.
- **Remaining risk:** secrets in novel formats not covered by patterns.

## 14. Backup leakage

- **Preventive:** encrypted RDS storage and snapshots (KMS); secrets in the DB are envelope-encrypted
  with AAD, so a stolen backup without KMS access does not reveal ExternalIds/keys; no raw AWS
  responses stored.
- **Remaining risk:** backups still contain tenant inventory/cost metadata; restrict snapshot
  sharing and KMS key policies.

## 15. Malicious workspace member

- **Scenario:** an insider exports data or disconnects accounts.
- **Preventive:** least-privilege roles (e.g. Viewer cannot export; only Admin/Owner see the
  ExternalId); rate-limited exports; typed confirmation for disconnect.
- **Detective:** append-only audit log (DB triggers block UPDATE/DELETE/TRUNCATE) covering exports,
  connections, role changes, suppressions.
- **Remaining risk:** authorised readers can still copy data they are allowed to see.

## 16. AWS API abuse & denial of service

- **Scenario:** users trigger unbounded AWS calls (cost: Cost Explorer is billed per request) or
  exhaust the app.
- **Preventive:** manual sync rate limit per account; DB-enforced single active job per
  account/type; bounded concurrency; adaptive retries with jitter; pagination caps; Cost Explorer
  incremental windows; metrics cached 5 min + per-org limit; request body size limits; statement
  timeouts; live streams time-boxed to 5 min.
- **Detective:** metrics for AWS calls/throttles/job outcomes; rate-limit logs.
- **Remaining risk:** volumetric DDoS — requires AWS WAF / Shield in front of the load balancer.
