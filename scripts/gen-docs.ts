// Generates docs/IAM.md and docs/RBAC.md from the source of truth (run: npm run docs:gen).
import { writeFileSync } from "node:fs";
import { ACTION_PERMISSIONS, DATA_PLANE_DENY, READ_PERMISSIONS } from "../src/server/aws/permissions";
import { actionPolicy, dataPlaneDenyPolicy, readOnlyPolicy, trustPolicy } from "../src/server/aws/templates";
import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from "../src/lib/rbac";

const iam = `# AWS IAM permissions

> Generated from \`src/server/aws/permissions.ts\` — do not edit by hand (\`npm run docs:gen\`).

Stratus never requires \`AdministratorAccess\` (or even AWS's broad \`ReadOnlyAccess\`, which can read S3 objects).
The customer role grants **metadata reads only**, and explicitly **denies** data-plane and secret reads.

## Read-only role (\`StratusReadOnlyRole\`)

| Action | Capability | Why Stratus needs it |
|---|---|---|
${READ_PERMISSIONS.map((p) => `| \`${p.action}\` | ${p.capability} | ${p.reason} |`).join("\n")}

## Explicit deny (defence in depth)

${DATA_PLANE_DENY.map((a) => `- \`${a}\``).join("\n")}

## Optional action role (\`StratusActionRole\`) — disabled by default

Deployed separately, only if a workspace owner enables operational actions. Restricted to EC2 instances
the customer tags \`stratus:actions-allowed=true\`.

| Action | Destructive | Why |
|---|---|---|
${ACTION_PERMISSIONS.map((p) => `| \`${p.action}\` | ${p.destructive ? "yes" : "no"} | ${p.reason} |`).join("\n")}

## Trust policy (per connection)

The role trusts only the Stratus platform principal, and only when the connection's unique ExternalId is presented:

\`\`\`json
${JSON.stringify(trustPolicy("arn:aws:iam::<PLATFORM_ACCOUNT_ID>:role/<PLATFORM_ROLE>", "<UNIQUE_EXTERNAL_ID>"), null, 2)}
\`\`\`

## Policy documents

<details><summary>Read-only policy</summary>

\`\`\`json
${JSON.stringify(readOnlyPolicy(), null, 2)}
\`\`\`
</details>

<details><summary>Deny policy</summary>

\`\`\`json
${JSON.stringify(dataPlaneDenyPolicy(), null, 2)}
\`\`\`
</details>

<details><summary>Action policy (optional role)</summary>

\`\`\`json
${JSON.stringify(actionPolicy(), null, 2)}
\`\`\`
</details>

## Platform (Stratus's own) IAM role

The web and worker tasks run with a role that needs only:

- \`sts:AssumeRole\` on \`arn:aws:iam::*:role/StratusReadOnlyRole\` (and \`StratusActionRole\` if action mode is offered)
- \`kms:GenerateDataKey\` / \`kms:Decrypt\` on the Stratus envelope-encryption key, with an \`kms:EncryptionContext:app = stratus\` condition
- \`secretsmanager:GetSecretValue\` on the Stratus runtime secrets (via the ECS task definition)
- CloudWatch Logs write permissions (task execution role)
`;
writeFileSync("docs/IAM.md", iam);

const rbac = `# RBAC model

> Generated from \`src/lib/rbac.ts\` — do not edit by hand (\`npm run docs:gen\`).

Every API route and page authorises **server-side** through \`authorizeOrg()\`:
authentication → organization membership → permission. Hidden UI controls are cosmetic only.
Cross-tenant or unknown ids return **404** (no existence oracle).

## Roles

${ROLES.map((r) => `- **${ROLE_LABELS[r]}** — ${ROLE_DESCRIPTIONS[r]}`).join("\n")}

## Permission matrix

| Permission | ${ROLES.map((r) => ROLE_LABELS[r]).join(" | ")} |
|---|${ROLES.map(() => ":-:").join("|")}|
${PERMISSIONS.map((p) => `| \`${p}\` | ${ROLES.map((r) => (ROLE_PERMISSIONS[r].has(p) ? "✓" : "")).join(" | ")} |`).join("\n")}

## Role assignment rules

- Only owners can grant, modify or remove the Owner and Admin roles.
- Admins can manage Operator/Viewer/Billing Viewer/Security Viewer members.
- Members cannot change their own role; a workspace must always keep at least one owner.
- Invitations are single-use, expire after 7 days, are bound to the invited email and stored only as a SHA-256 hash.
`;
writeFileSync("docs/RBAC.md", rbac);
process.stdout.write("docs/IAM.md and docs/RBAC.md generated\n");
