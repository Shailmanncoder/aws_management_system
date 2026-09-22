# RBAC model

> Generated from `src/lib/rbac.ts` — do not edit by hand (`npm run docs:gen`).

Every API route and page authorises **server-side** through `authorizeOrg()`:
authentication → organization membership → permission. Hidden UI controls are cosmetic only.
Cross-tenant or unknown ids return **404** (no existence oracle).

## Roles

- **Owner** — Full control including workspace deletion and enabling operational actions.
- **Admin** — Manage members, AWS connections, alerts and settings.
- **Operator** — Trigger syncs, view all data, acknowledge alerts, request operational actions.
- **Viewer** — Read-only access to inventory, cost and optimisation data.
- **Billing Viewer** — Cost and optimisation data only.
- **Security Viewer** — Inventory, security findings and audit logs.

## Permission matrix

| Permission | Owner | Admin | Operator | Viewer | Billing Viewer | Security Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `org:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org:update` | ✓ | ✓ |  |  |  |  |
| `org:delete` | ✓ |  |  |  |  |  |
| `members:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `members:invite` | ✓ | ✓ |  |  |  |  |
| `members:manage` | ✓ | ✓ |  |  |  |  |
| `aws_accounts:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `aws_accounts:connect` | ✓ | ✓ |  |  |  |  |
| `aws_accounts:disconnect` | ✓ | ✓ |  |  |  |  |
| `sync:trigger` | ✓ | ✓ | ✓ |  |  |  |
| `inventory:read` | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `metrics:read` | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `cost:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `security:read` | ✓ | ✓ | ✓ |  |  | ✓ |
| `security:manage` | ✓ | ✓ |  |  |  |  |
| `optimization:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `optimization:manage` | ✓ | ✓ | ✓ |  |  |  |
| `alerts:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `alerts:acknowledge` | ✓ | ✓ | ✓ |  |  |  |
| `alerts:manage` | ✓ | ✓ |  |  |  |  |
| `audit:read` | ✓ | ✓ |  |  |  | ✓ |
| `reports:export` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `actions:request` | ✓ | ✓ | ✓ |  |  |  |
| `actions:configure` | ✓ |  |  |  |  |  |

## Role assignment rules

- Only owners can grant, modify or remove the Owner and Admin roles.
- Admins can manage Operator/Viewer/Billing Viewer/Security Viewer members.
- Members cannot change their own role; a workspace must always keep at least one owner.
- Invitations are single-use, expire after 7 days, are bound to the invited email and stored only as a SHA-256 hash.
