import "server-only";
import { JWT } from "google-auth-library";
import { ClientSecretCredential } from "@azure/identity";
import { z } from "zod";
import type { CloudInput, CloudResource, CloudCost, CloudFinding, CloudSnapshot } from "@/lib/cloud";
import { AppError } from "../errors";

const object = z.record(z.string(), z.unknown());
const text = (value: unknown, fallback = "Unknown") => typeof value === "string" ? value.slice(0, 2048) : fallback;
const record = (value: unknown): Record<string, unknown> => object.parse(value ?? {});
const list = (value: unknown): Record<string, unknown>[] => z.array(object).parse(value ?? []);
const limit = () => new AppError("SERVICE_UNAVAILABLE", "The provider returned too much data for one refresh. The previous complete snapshot is retained; narrow the connected project or subscription.");
export const cloudMessage = (err: unknown) => err instanceof AppError ? err.publicMessage : "The cloud request failed. Check credentials, API enablement and read permissions, then retry.";

/** Bearer tokens only go to fixed provider hosts; redirects and untrusted pagination are rejected. */
export function validateCloudUrl(url: string, allowedHost: string, pathPrefix: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.host !== allowedHost || parsed.username || parsed.password || !parsed.pathname.toLowerCase().startsWith(pathPrefix.toLowerCase())) {
    throw new AppError("SERVICE_UNAVAILABLE", "The provider returned an unexpected pagination URL.");
  }
  return parsed.toString();
}

export async function cloudToken(input: CloudInput): Promise<string> {
  try {
    if (input.provider === "GCP") {
      const client = new JWT({ email: input.serviceAccount.client_email, key: input.serviceAccount.private_key, scopes: ["https://www.googleapis.com/auth/cloud-platform"], transporterOptions: { timeout: 15000 } });
      const result = await client.authorize();
      if (!result.access_token) throw new Error("Missing token");
      return result.access_token;
    }
    const credential = new ClientSecretCredential(input.tenantId, input.clientId, input.clientSecret);
    return (await credential.getToken("https://management.azure.com/.default", { abortSignal: AbortSignal.timeout(20000) })).token;
  } catch {
    throw new AppError("PRECONDITION_FAILED", "Authentication failed. Check the service account key or Azure tenant, application ID and secret. Expired credentials must be replaced.");
  }
}

function client(token: string, deadline: AbortSignal) {
  return async (url: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "error", cache: "no-store", signal: AbortSignal.any([deadline, AbortSignal.timeout(25000)]) });
    if (!response.ok) {
      const message = [401,403].includes(response.status) ? "Permission denied or credentials expired. Check the setup roles and enabled APIs." : response.status === 429 ? "The provider is limiting requests. Wait a few minutes and refresh again." : "The provider could not complete this request. Check setup and try again.";
      throw new AppError("SERVICE_UNAVAILABLE", `${message} (HTTP ${response.status})`);
    }
    // Bound each response before parsing; credentials and raw payloads never reach logs.
    const raw = await response.text();
    if (raw.length > 15_000_000) throw limit();
    return object.parse(JSON.parse(raw));
  };
}
type RequestCloud = ReturnType<typeof client>;

async function googlePages(request: RequestCloud, endpoint: string, key: string) {
  const rows: Record<string, unknown>[] = [];
  let pageToken = "";
  const seen = new Set<string>();
  for (let page = 0; page < 40; page++) {
    const url = new URL(endpoint);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await request(url.toString());
    rows.push(...list(result[key]));
    if (rows.length > 10000) throw limit();
    pageToken = text(result.nextPageToken, "");
    if (!pageToken) return rows;
    if (seen.has(pageToken)) throw limit();
    seen.add(pageToken);
  }
  throw limit();
}
async function azurePages(request: RequestCloud, endpoint: string, subscriptionId: string, body?: unknown, cost = false) {
  const pages: Record<string, unknown>[] = [];
  let next = endpoint;
  const seen = new Set<string>();
  while (next) {
    validateCloudUrl(next, "management.azure.com", `/subscriptions/${subscriptionId}/`);
    if (seen.has(next) || pages.length >= 40) throw limit();
    seen.add(next);
    const result = await request(next, body);
    const data = cost ? record(result.properties) : result;
    pages.push(data);
    next = text(data.nextLink, "");
  }
  return pages;
}

async function gcpInventory(input: Extract<CloudInput,{provider:"GCP"}>, request: RequestCloud): Promise<CloudResource[]> {
  const assets = await googlePages(request, `https://cloudasset.googleapis.com/v1/projects/${input.projectId}/assets?contentType=RESOURCE&pageSize=500`, "assets");
  return assets.map(a => { const resource = record(a.resource), data = record(resource.data); return { id: text(a.name), name: text(data.displayName, text(data.name, text(a.name))), type: text(a.assetType), region: text(resource.location, "global") }; });
}
async function gcpSecurity(input: Extract<CloudInput,{provider:"GCP"}>, request: RequestCloud): Promise<CloudFinding[]> {
  const rows = await googlePages(request, `https://securitycenter.googleapis.com/v1/projects/${input.projectId}/sources/-/findings?filter=state%3D%22ACTIVE%22&pageSize=500`, "listFindingsResults");
  return rows.map(row => { const f = record(row.finding); return { id: text(f.name), title: text(f.category), severity: text(f.severity), resource: text(f.resourceName) }; });
}
async function gcpBilling(input: Extract<CloudInput,{provider:"GCP"}>, request: RequestCloud): Promise<CloudCost[]> {
  if (!input.billingTable) throw new AppError("PRECONDITION_FAILED", "Billing export is not configured. Add your BigQuery billing export table when connecting or replacing credentials.");
  const queryProject = input.billingTable.split(".")[0];
  const query = `SELECT FORMAT_DATE('%F', DATE(usage_start_time)) AS day, currency, SUM(cost) AS amount FROM \`${input.billingTable}\` WHERE project.id = @project AND usage_start_time >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)) AND usage_start_time < TIMESTAMP(DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) GROUP BY day, currency ORDER BY day`;
  let result = await request(`https://bigquery.googleapis.com/bigquery/v2/projects/${queryProject}/queries`, { query, useLegacySql: false, parameterMode: "NAMED", queryParameters: [{ name: "project", parameterType: { type: "STRING" }, parameterValue: { value: input.projectId } }], maximumBytesBilled: "1000000000", timeoutMs: 15000, maxResults: 1000, location: input.billingLocation });
  const job = record(result.jobReference);
  const jobId = text(job.jobId, "");
  const resultUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${queryProject}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(input.billingLocation)}&timeoutMs=10000&maxResults=1000`;
  for (let attempt = 0; result.jobComplete !== true && attempt < 12; attempt++) {
    if (!jobId) throw new Error("Missing job reference");
    result = await request(resultUrl);
  }
  if (result.jobComplete !== true || (Array.isArray(result.errors) && result.errors.length > 0)) throw new AppError("SERVICE_UNAVAILABLE", "The billing query did not finish. Verify the export table, location and BigQuery permissions. Queries are limited to 1 GB scanned.");
  const rows: CloudCost[] = [];
  for (let page = 0; page < 10; page++) {
    for (const row of list(result.rows)) {
      const f = list(row.f);
      const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(f[0]?.v), currency = z.string().regex(/^[A-Z]{3}$/).parse(f[1]?.v);
      const amount = z.coerce.number().finite().parse(f[2]?.v);
      rows.push({day,currency,amount});
    }
    const token = text(result.pageToken, "");
    if (!token) return rows;
    result = await request(`${resultUrl}&pageToken=${encodeURIComponent(token)}`);
  }
  throw limit();
}
async function azureInventory(input: Extract<CloudInput,{provider:"AZURE"}>, request: RequestCloud): Promise<CloudResource[]> {
  const pages = await azurePages(request, `https://management.azure.com/subscriptions/${input.subscriptionId}/resources?api-version=2021-04-01`, input.subscriptionId);
  const rows = pages.flatMap(p => z.array(object).parse(p.value));
  if (rows.length > 10000) throw limit();
  return rows.map(r => ({id:text(r.id),name:text(r.name),type:text(r.type),region:text(r.location,"global")}));
}
async function azureSecurity(input: Extract<CloudInput,{provider:"AZURE"}>, request: RequestCloud): Promise<CloudFinding[]> {
  const pages = await azurePages(request, `https://management.azure.com/subscriptions/${input.subscriptionId}/providers/Microsoft.Security/assessments?api-version=2020-01-01`, input.subscriptionId);
  const rows = pages.flatMap(p => z.array(object).parse(p.value));
  if (rows.length > 10000) throw limit();
  return rows.filter(r => record(record(r.properties).status).code === "Unhealthy").map(r => { const p=record(r.properties); return {id:text(r.id),title:text(p.displayName),severity:text(record(p.metadata).severity,"UNSPECIFIED").toUpperCase(),resource:text(record(p.resourceDetails).id)}; });
}
async function azureBilling(input: Extract<CloudInput,{provider:"AZURE"}>, request: RequestCloud): Promise<CloudCost[]> {
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-29));
  const body = { type:"Usage",timeframe:"Custom",timePeriod:{from:start.toISOString(),to:now.toISOString()},dataset:{granularity:"Daily",aggregation:{totalCost:{name:"PreTaxCost",function:"Sum"}}} };
  const pages = await azurePages(request, `https://management.azure.com/subscriptions/${input.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`, input.subscriptionId, body, true);
  return pages.flatMap(page => {
    const cols = z.array(z.object({name:z.string()})).parse(page.columns).map(c=>c.name);
    const amountIndex=cols.findIndex(c=>["PreTaxCost","Cost"].includes(c)), dayIndex=cols.indexOf("UsageDate"), unitIndex=cols.indexOf("Currency");
    if ([amountIndex,dayIndex,unitIndex].some(i=>i<0)) throw new Error("Unexpected cost columns");
    return z.array(z.array(z.unknown())).parse(page.rows).map(row=>{
      const raw=z.coerce.string().regex(/^\d{8}$/).parse(row[dayIndex]);
      return {day:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`,amount:z.coerce.number().finite().parse(row[amountIndex]),currency:z.string().regex(/^[A-Z]{3}$/).parse(row[unitIndex])};
    });
  });
}

/** Each capability commits only a complete result. A denied capability is not an empty success. */
export async function collectCloud(input: CloudInput, token: string): Promise<CloudSnapshot> {
  const request = client(token, AbortSignal.timeout(200000));
  const tasks = input.provider === "GCP" ? [gcpInventory(input,request),gcpBilling(input,request),gcpSecurity(input,request)] : [azureInventory(input,request),azureBilling(input,request),azureSecurity(input,request)];
  const results = await Promise.allSettled(tasks);
  const diagnostics: Record<string,string> = {};
  for (const [i,key] of ["inventory","billing","security"].entries()) { const r=results[i]!; diagnostics[key]=r.status === "fulfilled" ? "Ready" : cloudMessage(r.reason); }
  return {inventory:results[0]!.status === "fulfilled" ? results[0]!.value as CloudResource[] : null,billing:results[1]!.status === "fulfilled" ? results[1]!.value as CloudCost[] : null,security:results[2]!.status === "fulfilled" ? results[2]!.value as CloudFinding[] : null,diagnostics};
}
