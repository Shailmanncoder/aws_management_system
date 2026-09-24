# Operations

The Operations page (`/operations`) brings the saved feature roadmap into one workspace.
This release implements a first working version of all 20 ideas. Scope and evidence limits
are listed below; these are not claims of complete AWS or multi-cloud coverage.

## Features and current scope

| Feature | Available behavior | Current boundary |
| --- | --- | --- |
| Resource change history | Durable before/after configuration and tag snapshots, discovery, reappearance and confirmed deletion events from successful collector scopes. | Starts after installation; no historical backfill or inferred actor. UI shows recent events; records remain in the database. |
| Cost spike alerts | Latest reported day compared with seven consecutive prior days, split by account/currency, with service spending and available service deltas. | Billing can lag or be estimated; incomplete baselines are excluded rather than treated as zero. |
| Resource ownership | Persisted person/team labels for individual resources; unowned inventory filter. | Ownership is organizational metadata, not an IAM permission or AWS tag. API also accepts an existing workspace project. |
| Action center | Existing findings, savings and sync priorities together, contextual assignment links, assigned work and completion controls. | Completion of a help request does not resolve the underlying finding. |
| Approval workflows | Immutable reviewed resource snapshots; a second administrator approves/rejects; request cancellation and execution receipts. | Applies to requests created in Operations. Existing direct resource editing and provisioning keep their existing workflows. |
| Scheduled shutdowns | One-time future stop/start requests, local-time entry with recorded IANA time zone, cancellation, expiry and worker execution. | Create separate stop and restart occurrences. Recurring calendars are not included. Missed runs expire after 15 minutes rather than running unexpectedly later. |
| Shared saved views | Server-backed personal/shared inventory views, usable across devices and from inventory pages. | Personal browser-local views remain available separately. Links use the currently selected workspace. |
| Tag coverage | Missing/empty required tags and links to individual edits or reviewed bulk corrections. | Required tag policy comes from existing workspace settings. |
| Dependency/impact explorer | Exact normalized identifier references, scoped to account and region, linked to resource detail pages. | Inferred from inventory references, not application tracing or a complete blast-radius guarantee. |
| Backup readiness | RDS retention/latest restorable time and newest observed completed volume snapshot, with stale-snapshot review hints. | Missing evidence is unknown; restore verification is not performed. |
| Credential/certificate reminders | Observed active IAM key age/hints and RDS certificate expiry; configurable dated reminders generate in-app alerts. | Key metadata needs a successful security scan; certificates outside observed RDS metadata can be entered manually. Never stores full access key IDs or secret values here. |
| External notifications | Per-rule/all-new-alert email subscriptions to verified workspace members, queued test delivery, deduplication and bounded retries with receipts. | Requires SMTP and worker; generic links only. No Slack or webhooks in this release. |
| Unified multi-cloud overview | AWS/GCP/Azure account status, inventory freshness, and available provider billing snapshots on one screen. | Provider-specific billing definitions and currencies stay separate. AWS automation is not presented as GCP/Azure automation. |
| Drift detection | Server-captured resource baseline, observed differences and explicit acceptance of current configuration. | Coarse field differences with full before/after evidence; resource must be in the available inventory. |
| Bulk resource actions | Reviewed, separately authorized EC2 lifecycle operations and additive/replacement tags with per-resource receipts. | Bulk tags support instances, VPCs, subnets and volumes. No destructive termination or bulk deletion. Other tag keys are preserved. |
| Savings outcome tracking | Accepted recommendation with immutable seven-day account spending baseline and a seven-day following window. | Account-level observed change, not proof of resource-level savings; incomplete days/currencies are shown separately. |
| Environment health | Persisted tag-based groups, resource counts, ownership gaps, stale/incomplete observations and permission-filtered linked findings. | Resource state is not application uptime; environment costs are unavailable without resource-level attribution. |
| Incident workspace | Linked resources, assignee, status, notes timeline, checklist, recent configuration changes, findings and monitoring evidence. | Uses stored observations; no live log ingestion. |
| Provisioning templates | Save reviewed creation configuration; reuse with an optional new resource name; re-run current guardrails and review before deployment. | Existing single-resource provisioning services and permissions. Templates are account-specific. |
| Plain-language inventory search | Translate supported service/state/environment/region/owner phrases to visible filters and then open inventory. | Deterministic, read-only interpretation; unsupported words are explicitly not interpreted. No external AI service or autonomous action execution. |

## Setup

Apply migrations with `npm run db:migrate`, regenerate the Prisma client with `npm run db:generate`,
and rebuild/restart the web service and worker. The additive migration is
`20260924100000_operations`. The preceding multi-cloud migration is also required.
No default subscriptions, schedules or cloud mutations are created by installation.

### Reviewed actions

1. An Owner configures a separate action role for a connected AssumeRole AWS account under
   Operations → Automation, and explicitly enables workspace action mode.
2. Deploy that role in the same AWS account. Trust the platform identity and require the existing
   connection ExternalId. Restrict resources/actions to the intended scope. Supported calls are
   `ec2:DescribeInstances`, `ec2:StartInstances`, `ec2:StopInstances`, `ec2:RebootInstances`, and
   `ec2:CreateTags`; describe calls require the AWS-supported resource scope.
3. An authorized requester chooses resources and creates a request. Another Owner/Admin reviews
   the immutable snapshots and approves. Manual requests can then execute; future stop/start
   requests run through the worker.

The read-only role is rejected as the action role. Live AWS mode, membership, permissions,
action-mode configuration and connection status are rechecked at execution. Manual plans
also require the reviewed inventory state. Scheduled start/stop permits lifecycle state to
change between review and execution but still checks reviewed configuration and queries AWS
for the required current lifecycle state immediately before the write.

Plans are claimed with a conditional database transition. Mutating SDK requests use one
attempt. Uncertain outcomes require inspection and are never automatically replayed by the
application. AWS acceptance is recorded separately from subsequent inventory confirmation;
run a sync to observe final state. Operations requests do not make other mutation endpoints
subject to this approval workflow.

### Email delivery and reminders

Configure the existing `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, and optional
SMTP authentication settings. SMTP transport requires TLS and certificate verification.
Only verified workspace members are eligible recipients. Both the subscription creator's
management rights and recipient's membership/access are rechecked before sending.

The worker checks for events once per minute. Subscriptions begin with new alerts created
at or after subscription creation; polling scans up to the most recent 500 matching alerts
per subscription. Delivery is deduplicated by subscription and event. Failures retry up to
three times with increasing delay. SMTP does not guarantee exactly-once delivery, so duplicates
remain possible. Interrupted sends are marked `CHECK_REQUIRED`, not silently replayed.

Reminder names and due dates appear in in-app alerts. Do not put secrets into names, tags,
notes or reminder text. Email messages contain a generic application link and no resource
or finding details. Users select the relevant workspace after opening the link.

## Access and limits

All API calls use the existing authentication, organization authorization, CSRF checks,
input validation and rate limits. `operations:manage` is granted to Owners, Admins and
Operators. Inventory/cost/security/metrics data keep their separate read permissions.
Read-only users may create personal saved views but cannot publish shared views or perform
operational writes. Incidents require operations access. Resource, member, finding, project
and account references are validated in the caller's workspace.

Saved record edits use versions to reject stale updates. Creators/admins manage saved items;
an incident assignee can also update their incident. Operation payloads and savings baselines
cannot be edited after creation. Cancelling a request does not undo an already executed action.

The overview loads up to 2,000 resources, 20,000 cost rows, 500 saved items, 200 change events,
100 operation requests, 100 delivery receipts, 500 open findings, and 1,000 metric summaries.
Several panels show shorter subsets. These bounded views are not complete account exports.
Inventory and Cost Explorer remain the primary paginated data views.

## Verification

Automated checks cover tenant separation, private/shared views, role checks, resource reference
validation, stale updates, baseline capture, history idempotence, deletion evidence, separate
approvals, expiry, permission revocation, snapshot drift, AWS state checks, uncertain results,
SMTP permission checks, delivery retries, and cost/date/currency handling. Browser tests exercise
the new workspace workflow and every Operations section at desktop and mobile sizes.

Tests use isolated databases, synthetic AWS inventory, and mocked mutation/mail transports.
No live AWS writes or external emails were sent during implementation. Live execution and
real SMTP delivery must be verified with the configured deployment.
