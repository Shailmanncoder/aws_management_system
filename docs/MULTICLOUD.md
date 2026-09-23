# GCP and Azure connections

The application can connect a Google Cloud project or an Azure public-cloud subscription with a
read-only identity. Open Settings → Cloud accounts → Google Cloud or Microsoft Azure. Each
provider dashboard belongs to the currently selected workspace and has its own connection filter.
AWS pages, budgets, projects, provisioning and automated alerts remain AWS-specific; GCP/Azure
snapshots are not mixed into those totals. Navigation labels and the home provider links make
this distinction explicit.

## Google Cloud

- Enable Cloud Asset Inventory API; grant Cloud Asset Viewer on the target project.
- Supply a dedicated service-account JSON key through the app. Organization policies may prohibit
  key creation; workload identity federation is not implemented in this release.
- Optional billing: enable standard/detailed billing export into BigQuery, then supply the full
  `project.dataset.table` identifier and dataset location. Grant BigQuery Data Viewer on the
  dataset and BigQuery Job User on the query project. Queries are SELECT-only, project-filtered,
  limited to the latest 30 days and capped at 1 GB billed per refresh. Query charges may apply.
  The displayed usage cost excludes credits and invoice adjustments.
- Optional security: enable Security Command Center and grant Security Center Findings Viewer.
  This release imports global v1 active findings, not location-specific v2 findings.

## Azure

- Use a dedicated Entra application/service principal with a client secret value.
- Enter tenant ID, application ID and subscription ID. National/sovereign clouds are not supported.
- Grant Reader at subscription scope, plus Cost Management Reader and Security Reader for billing
  and security. Actual billing visibility also depends on the subscription agreement.
- Resources come from ARM. Costs are daily PreTaxCost from Cost Management; findings are unhealthy
  Defender for Cloud assessments. No findings does not imply full scan coverage.

## Lifecycle and limits

Verify and connect performs real authentication and requires a complete inventory read before
saving the connection. Credentials are envelope-encrypted with workspace/connection AAD. Access
tokens are short-lived and never persisted. API responses never contain saved credentials.
Reconnect the same project/subscription to replace credentials. Disconnect removes saved
credentials, invalidates any in-flight refresh, and retains historical snapshots. Revoke the key
or secret separately in its provider portal when it is no longer needed.

Refresh is manual from the provider dashboard; it is not tied to the AWS background worker.
Each capability saves atomically only after its full result is collected. Failed capabilities
retain their last complete snapshot with a diagnostic and timestamp. A five-minute database
lease prevents overlapping refreshes, and a fencing token prevents disconnected/superseded
requests from committing. Expired leases can be reclaimed by a later refresh.

Pagination is bounded to 40 pages / 10,000 inventory resources or findings per connection.
Exceeding a limit is reported as incomplete and never replaces a previous complete snapshot.
The dashboard shows 200 matching inventory rows and the first 200 findings; search or filter
by connection to narrow the result. Provider calls have request and whole-refresh deadlines.
Azure pagination is restricted to the same HTTPS host and subscription. Provider redirects
are rejected. Input-controlled OAuth/token endpoints are ignored.

Validation uses mocked provider HTTP responses, a real isolated PostgreSQL database for API
and credential lifecycle tests, and production-build browser checks. Real GCP/Azure accounts
must still be connected by the operator to verify credentials, billing agreements and enabled
security services; no customer credentials are bundled or assumed.

References:
- https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/assets/list
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-setup
- https://docs.cloud.google.com/security-command-center/docs/reference/rest/v1/projects.sources.findings/list
- https://learn.microsoft.com/en-us/rest/api/resources/resources/list
- https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage
- https://learn.microsoft.com/en-us/rest/api/defenderforcloud/assessments/list
