import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCloud, validateCloudUrl } from "@/server/cloud/adapters";
import { cloudInput, type CloudInput } from "@/lib/cloud";
const subscription="11111111-1111-4111-8111-111111111111";
const azure:CloudInput={provider:"AZURE",displayName:"Azure test",subscriptionId:subscription,tenantId:subscription,clientId:subscription,clientSecret:"test-only-secret"};
const gcp:CloudInput={provider:"GCP",displayName:"GCP test",projectId:"sample-project",serviceAccount:{type:"service_account",project_id:"sample-project",client_email:"test@sample-project.iam.gserviceaccount.com",private_key:"test-only-key"},billingLocation:"US"};
afterEach(()=>vi.unstubAllGlobals());
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
describe("cloud adapter boundaries",()=>{
  it("rejects credential redirects, foreign subscriptions and userinfo",()=>{
    for(const url of ["https://evil.example/",`https://management.azure.com/subscriptions/other/resources`,`https://user@management.azure.com/subscriptions/${subscription}/resources`]) expect(()=>validateCloudUrl(url,"management.azure.com",`/subscriptions/${subscription}/`)).toThrow();
  });
  it("follows Azure pagination, parses cost columns by name and keeps only unhealthy assessments",async()=>{
    const calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{calls.push(url);
      if(url.includes("CostManagement"))return response({properties:{columns:[{name:"Currency"},{name:"UsageDate"},{name:"PreTaxCost"}],rows:[["USD",20260923,12.5]]}});
      if(url.includes("Security"))return response({value:[{id:"a",properties:{displayName:"Protect VM",status:{code:"Unhealthy"},resourceDetails:{id:"vm"}}},{id:"b",properties:{status:{code:"Healthy"}}}]});
      if(url.includes("page=2"))return response({value:[{id:"vm2",name:"Second",type:"VM",location:"westus"}]});
      return response({value:[{id:"vm1",name:"First",type:"VM",location:"eastus"}],nextLink:`https://management.azure.com/subscriptions/${subscription}/resources?page=2`});
    }));
    const result=await collectCloud(azure,"test-token");
    expect(result.inventory).toHaveLength(2);expect(result.billing).toEqual([{day:"2026-09-23",currency:"USD",amount:12.5}]);expect(result.security).toHaveLength(1);expect(calls).toHaveLength(4);
  });
  it("does not return partial inventory when a later Azure page fails or escapes the subscription",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("resources?")?response({value:[{id:"partial"}],nextLink:"https://evil.example/collect"}):response({},403)));
    const result=await collectCloud(azure,"test-token");expect(result.inventory).toBeNull();expect(result.diagnostics.inventory).toContain("unexpected pagination");expect(result.billing).toBeNull();
  });
  it("normalizes GCP assets without saving raw attributes and distinguishes unconfigured billing",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("cloudasset")?response({assets:[{name:"//compute/projects/sample-project/vm",assetType:"compute.googleapis.com/Instance",resource:{location:"us-central1",data:{name:"Website",secret:"do-not-store"}}}]}):response({listFindingsResults:[]})));
    const result=await collectCloud(gcp,"test-token");expect(result.inventory?.[0]).toEqual({id:"//compute/projects/sample-project/vm",name:"Website",type:"compute.googleapis.com/Instance",region:"us-central1"});expect(result.billing).toBeNull();expect(result.diagnostics.billing).toContain("not configured");expect(result.security).toEqual([]);
  });
  it("pins BigQuery SQL to the selected project and caps billed bytes",async()=>{
    let sent:Record<string,unknown>|undefined;
    vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
      if(url.includes("bigquery")){sent=JSON.parse(String(init.body));return response({jobComplete:true,rows:[{f:[{v:"2026-09-23"},{v:"EUR"},{v:"-2.50"}]}]});}
      return response(url.includes("cloudasset")?{assets:[]}:{listFindingsResults:[]});
    }));
    const result=await collectCloud({...gcp,billingTable:"sample-project.billing.export_table"},"test-token");expect(result.billing?.[0].amount).toBe(-2.5);expect(sent?.maximumBytesBilled).toBe("1000000000");expect(sent?.queryParameters).toEqual([{name:"project",parameterType:{type:"STRING"},parameterValue:{value:"sample-project"}}]);
  });
  it("rejects table injection and strips user-controlled auth URLs from service-account JSON",()=>{
    const valid={...gcp,serviceAccount:{...gcp.serviceAccount,private_key:"x".repeat(150),token_uri:"https://evil.example"}};
    const parsed=cloudInput.parse(valid);expect(JSON.stringify(parsed)).not.toContain("evil.example");expect(cloudInput.safeParse({...valid,billingTable:"project.table`; DROP TABLE x"}).success).toBe(false);
  });
});
