"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api-client";
import { cloudInput, type CloudProvider } from "@/lib/cloud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function ConnectCloud({orgId,provider}:{orgId:string;provider:CloudProvider}) {
  const router=useRouter(),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[key,setKey]=useState(0);
  return <Card><CardHeader><CardTitle>Connect {provider === "GCP" ? "Google Cloud" : "Microsoft Azure"}</CardTitle></CardHeader><CardContent className="space-y-5">
    <div className="rounded-lg bg-muted/50 p-4 text-sm leading-relaxed">
      {provider === "GCP" ? <><p className="font-medium">One project per connection</p><ol className="mt-2 list-decimal space-y-2 pl-5"><li>Enable Cloud Asset Inventory API. Give a dedicated service account <strong>Cloud Asset Viewer</strong> on the project.</li><li>For security findings, enable Security Command Center and grant <strong>Security Center Findings Viewer</strong>. Global findings are supported.</li><li>For spending, configure a standard or detailed <a href="https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-setup" target="_blank" rel="noreferrer" className="underline">BigQuery billing export</a>. Grant <strong>BigQuery Data Viewer</strong> on that dataset and <strong>BigQuery Job User</strong> on its project. Enable BigQuery API.</li><li>Download a JSON key for this service account and choose it below. Organization policies may restrict key creation.</li></ol></> : <><p className="font-medium">One Azure public-cloud subscription per connection</p><ol className="mt-2 list-decimal space-y-2 pl-5"><li>Create a dedicated <a href="https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal" target="_blank" rel="noreferrer" className="underline">app registration and service principal</a> in your tenant.</li><li>Assign <strong>Reader</strong> on the subscription. Add <strong>Cost Management Reader</strong> and <strong>Security Reader</strong> for costs and Defender for Cloud assessments.</li><li>Create a client secret and copy its <strong>value</strong>, not its ID. Enter the tenant, application, and subscription IDs below.</li><li>Allow time for role assignments to propagate. Billing access depends on your subscription agreement.</li></ol></>}
    </div>
    <form key={key} className="grid gap-4 sm:grid-cols-2" onSubmit={async e=>{
      e.preventDefault();setPending(true);setError(null);const form=new FormData(e.currentTarget);
      try {
        let body:unknown;
        if(provider === "GCP") { const file=form.get("keyFile"); if(!(file instanceof File)||file.size>20000||!file.size) throw new Error("Choose a service account JSON key under 20 KB."); body={provider,displayName:String(form.get("displayName")),projectId:String(form.get("projectId")).trim(),serviceAccount:JSON.parse(await file.text()),...(String(form.get("billingTable")).trim()?{billingTable:String(form.get("billingTable")).trim()}:{}),billingLocation:String(form.get("billingLocation")).trim()||"US"}; }
        else body={provider,displayName:String(form.get("displayName")),subscriptionId:String(form.get("subscriptionId")).trim(),tenantId:String(form.get("tenantId")).trim(),clientId:String(form.get("clientId")).trim(),clientSecret:String(form.get("clientSecret"))};
        const parsed=cloudInput.safeParse(body);if(!parsed.success)throw new Error("Check the account identifiers and credential fields. GCP needs a valid service-account JSON key; Azure IDs must be UUIDs.");
        await api(`/api/v1/orgs/${orgId}/cloud-connections`,{body:parsed.data});setKey(k=>k+1);router.refresh();
      }catch(err){setError(errorMessage(err));}finally{setPending(false);}
    }}>
      <label className="space-y-1 text-sm">Connection name<Input name="displayName" required minLength={2} maxLength={80} placeholder="Production" disabled={pending}/></label>
      {provider === "GCP" ? <><label className="space-y-1 text-sm">GCP project ID<Input name="projectId" required placeholder="my-project-123" disabled={pending}/></label><label className="space-y-1 text-sm sm:col-span-2">Service account JSON key<Input name="keyFile" type="file" accept=".json,application/json" required disabled={pending}/></label><label className="space-y-1 text-sm">Billing export table (optional)<Input name="billingTable" placeholder="project.dataset.gcp_billing_export_v1_ID" disabled={pending}/></label><label className="space-y-1 text-sm">Billing dataset location<Input name="billingLocation" defaultValue="US" disabled={pending}/></label></> : <>{[["subscriptionId","Subscription ID"],["tenantId","Tenant ID"],["clientId","Application (client) ID"],["clientSecret","Client secret value"]].map(([name,label])=><label key={name} className="space-y-1 text-sm">{label}<Input name={name} type={name === "clientSecret"?"password":"text"} autoComplete="off" required disabled={pending}/></label>)}</>}
      <div className="space-y-3 sm:col-span-2"><p className="text-xs leading-relaxed text-muted-foreground">Credentials are encrypted and never displayed again. Connecting the same account replaces its saved credentials. This connection reads cloud data; it does not create or change infrastructure. Refresh is manual. {provider === "GCP" && "Billing queries can incur BigQuery charges, capped at 1 GB scanned per refresh. Costs are before credits and adjustments."}</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={pending}>{pending?"Verifying access and syncing…":"Verify and connect"}</Button><p className="text-xs text-muted-foreground">Initial verification can take a few minutes. Keep this page open.</p></div>
    </form>
  </CardContent></Card>;
}
