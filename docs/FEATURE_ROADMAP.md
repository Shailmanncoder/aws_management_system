# Stratus feature ideas

Saved from the product discussion on 24 September 2026.

The user authorized implementation of all 20 ideas on 24 September 2026. First working
versions are now implemented in the Operations area. See [Operations](OPERATIONS.md) for
the implemented behavior, setup, verification, and explicit first-release boundaries.
The tables below preserve the original product discussion.

## Ideas from the initial discussion

| Feature | Proposed addition |
| --- | --- |
| Resource change history | A per-resource timeline showing configuration and tag differences between successful syncs, plus creation and deletion observations. Distinguish an unavailable scan from a confirmed deletion; only identify the actor when supporting audit data is available. |
| Cost spike alerts | Extend existing cost alerts with unusual-spending detection, account/service breakdowns, and explanations of the comparison period and billing delay. |
| Resource ownership | Assign individual resources to a person, team, or project, extending the existing whole-account project grouping. |
| Action center | Extend existing priorities and team help requests into a common queue for findings, savings opportunities, and sync failures, with assignees and progress tracking. |
| Approval workflows | Let team members request infrastructure changes, then require an authorized approval of the exact plan before execution. Recheck permissions and resource state at execution. |
| Scheduled shutdowns | Schedule development-server stops and starts with time zones, exceptions, previews, execution history, and clear handling of missed or failed runs. |
| Shared saved views | Extend browser-local saved inventory views into workspace-backed views available across devices, with personal/shared visibility and editing permissions. |
| Tag coverage dashboard | Show missing required tags, such as owner, environment, and project, and offer reviewed corrections. |

## Additional ideas

| Feature | What users would gain | First useful version |
| --- | --- | --- |
| Dependency and impact explorer | Understand what depends on a resource before changing it. | Extend existing topology graphs with linked resources and an impact preview; label relationships that cannot be determined. |
| Backup readiness | See resources with missing, stale, or failed backups. | Show last successful backup and coverage for supported databases and volumes; distinguish backup presence from verified recoverability. |
| Credential and certificate reminders | Catch upcoming expiry and aging credentials. | A list of supported certificates and credentials with available expiry/rotation metadata and configurable reminders. |
| External notifications | Receive actionable alerts without opening the app. | One delivery channel first, with test delivery, deduplication, retry history, and per-rule recipients. |
| Unified multi-cloud overview | Compare AWS, GCP, and Azure from one workspace overview. | Provider summaries with coverage and freshness; keep currencies and incompatible billing measures separate. |
| Infrastructure drift detection | Know when observed configuration differs from an intended baseline. | Compare selected properties against a saved baseline, with explicit acceptance of intentional changes. |
| Bulk resource actions | Reduce repetitive resource maintenance. | Start with bulk tagging, a preview of each change, permission checks, and per-resource success/failure results. |
| Savings outcome tracking | Measure whether an optimization actually helped. | Record accepted recommendations and compare later spending with a dated baseline, clearly separating estimates from observed changes. |
| Environment health pages | See production, staging, and development status separately. | Saved environment groups showing resource health, open findings, ownership gaps, and spend where attribution is supported. |
| Incident workspace | Investigate an issue with the relevant evidence in one place. | Combine resource changes, monitoring signals, findings, notes, and assigned follow-up tasks into a dated incident record. |
| Reusable provisioning templates | Create common environments consistently. | Named templates for the existing single-resource provisioning flow, with parameter review and cost context before creation. |
| Plain-language inventory search | Find resources without knowing service names or filter syntax. | Translate questions such as “show running production servers without an owner” into visible, editable filters; keep the initial version read-only. |

## Suggested sequence

1. **Resource change history:** establish the evidence needed for troubleshooting and later drift/incident features.
2. **Resource ownership and tag coverage:** make issues attributable and improve inventory organization.
3. **Cost spike explanations and external notifications:** make important changes easier to discover and investigate.
4. **Shared saved views and action center:** help teams coordinate recurring work.
5. **Approval workflows, then bulk actions and scheduling:** add operational automation with review, audit history, and failure handling.

Backup readiness and dependency exploration are strong alternatives if operational reliability
is the immediate priority. Unified multi-cloud work depends on expanding provider coverage;
existing AWS-specific budgets and workflows should not be presented as multi-cloud already.

## Current baseline and scope notes

- Browser-local saved inventory views and copyable view links have been added in the current working tree.
- Existing capabilities include resource editing, EC2 lifecycle controls, S3 configuration,
  tagging, topology graphs, budgets, in-app alerts, priorities, team help requests, and weekly summaries.
- GCP and Azure have separate read-only dashboards and capability limits documented in
  [Multi-cloud connections](MULTICLOUD.md).
- Implementation does not enable cloud actions, create schedules, or subscribe recipients
  automatically. Configure and review those workflows in the app before use.
