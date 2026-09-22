# Security policy

## Supported versions

Stratus is pre-1.0. Security fixes are made on the `main` branch only; deployments should track the
latest release.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public issue.

- Use GitHub's *Report a vulnerability* (private security advisory) on this repository, or the
  security contact configured by the operator of your deployment.
- Include: affected version/commit, reproduction steps, impact, and any proof-of-concept.
- Do **not** include real AWS credentials, customer data or secrets in reports.

We aim to acknowledge reports within 3 business days and to provide a remediation plan within 14 days
for high/critical issues.

## Responsible disclosure

- Test only against deployments you own or have written permission to test.
- Never access, modify or exfiltrate other users' data; stop and report as soon as you can
  demonstrate impact.
- No denial-of-service, social engineering or physical attacks.
- Give us reasonable time to fix before public disclosure; we will credit reporters who wish it.

## Secret-handling policy

- No secrets in Git, source files, Docker images or client bundles. Only `.env.example` (placeholders)
  is committed; `.env*` is git-ignored and excluded from Docker build context.
- Runtime secrets come from the environment (in production: AWS Secrets Manager via the ECS task
  definition). Configuration is validated at startup; error messages list variable names, never values.
- CI runs gitleaks; rotate any secret that is ever committed, even if removed later.
- Logs pass through mandatory redaction; never log request bodies of authentication endpoints.

## AWS credential policy

- Production onboarding uses an IAM role + `sts:AssumeRole` with a unique, Stratus-generated
  ExternalId per connection. Long-term access keys are not recommended and are disabled by default.
- Temporary STS credentials are never persisted and never leave server memory.
- Root-account credentials are rejected both for customer connections and for the platform's own
  identity (the web tier and worker refuse to start with root credentials).
- The customer role is read-only and explicitly denies data-plane/secret reads (see `docs/IAM.md`).
  Operational actions require a separate, optional role and explicit enablement by an owner.
- Stratus never modifies customer AWS resources without an explicit, confirmed, audited user action.
