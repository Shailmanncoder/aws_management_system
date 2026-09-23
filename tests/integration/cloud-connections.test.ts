import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const adapter=vi.hoisted(()=>({cloudToken:vi.fn(),collectCloud:vi.fn(),cloudMessage:(e:unknown)=>e instanceof Error?e.message:"Cloud failure"}));
vi.mock("@/server/cloud/adapters",()=>adapter);
import { GET, POST } from "@/app/api/v1/orgs/[orgId]/cloud-connections/route";
import { POST as refresh, DELETE as disconnect } from "@/app/api/v1/orgs/[orgId]/cloud-connections/[id]/route";
import { createUser,call,type TestUser } from "../helpers/app";
import { newOrg,addMember } from "../helpers/orgs";
import { getDb } from "@/server/db";
const ready={inventory:[{id:"vm",name:"Website",type:"VM",region:"eastus"}],billing:[{day:"2026-09-23",amount:10,currency:"USD"}],security:[{id:"finding",title:"Protect VM",severity:"HIGH",resource:"vm"}],diagnostics:{inventory:"Ready",billing:"Ready",security:"Ready"}};
const body={provider:"AZURE",displayName:"Azure Production",subscriptionId:"22222222-2222-4222-8222-222222222222",tenantId:"33333333-3333-4333-8333-333333333333",clientId:"44444444-4444-4444-8444-444444444444",clientSecret:"private-test-secret-never-return"};
describe("multicloud tenant and credential lifecycle",()=>{
  let owner:TestUser,viewer:TestUser,billing:TestUser,stranger:TestUser,orgId:string,otherOrg:string,id:string;
  beforeAll(async()=>{owner=await createUser("cloud-owner");orgId=(await newOrg(owner,"Multi cloud")).id;viewer=await addMember(owner,orgId,"VIEWER");billing=await addMember(owner,orgId,"BILLING_VIEWER");stranger=await createUser("cloud-stranger");otherOrg=(await newOrg(stranger,"Other cloud")).id;});
  beforeEach(()=>{adapter.cloudToken.mockResolvedValue("test-token");adapter.collectCloud.mockResolvedValue(ready);});
  it("verifies, encrypts credentials, persists data, and never returns secrets",async()=>{
    const r=await call(POST,{user:owner,params:{orgId},body});expect(r.status).toBe(200);id=r.body.connection.id;expect(JSON.stringify(r.body)).not.toContain(body.clientSecret);
    const saved=await getDb().cloudConnection.findUniqueOrThrow({where:{id}});expect(saved.credentialsEnc).toMatch(/^v1\./);expect(saved.credentialsEnc).not.toContain(body.clientSecret);expect(r.body.connection.inventory).toHaveLength(1);
  });
  it("enforces membership, capability permissions and write roles",async()=>{
    expect((await call(POST,{user:viewer,params:{orgId},body})).status).toBe(403);
    expect((await call(refresh,{method:"POST",user:stranger,params:{orgId:otherOrg,id}})).status).toBe(404);
    const result=await call(GET,{user:billing,params:{orgId}});expect(result.body.connections[0].inventory).toBeNull();expect(result.body.connections[0].security).toBeNull();expect(result.body.connections[0].billing).toHaveLength(1);
    expect((await call(GET,{user:stranger,params:{orgId:otherOrg}})).body.connections).toHaveLength(0);
  });
  it("retains last complete data on partial refresh and clears data on a complete empty result",async()=>{
    adapter.collectCloud.mockResolvedValue({...ready,inventory:null,diagnostics:{...ready.diagnostics,inventory:"Permission denied"}});
    const result=await call(refresh,{method:"POST",user:owner,params:{orgId,id}});expect(result.status).toBe(200);expect(result.body.connection.inventory).toHaveLength(1);expect(result.body.connection.status).toBe("NEEDS_ATTENTION");
    adapter.collectCloud.mockResolvedValue({...ready,inventory:[]});expect((await call(refresh,{method:"POST",user:owner,params:{orgId,id}})).body.connection.inventory).toEqual([]);
  });
  it("deduplicates concurrent refresh and prevents a disconnected sync from restoring credentials",async()=>{
    await getDb().cloudConnection.update({where:{id},data:{leaseUntil:new Date(Date.now()+60000)}});expect((await call(refresh,{method:"POST",user:owner,params:{orgId,id}})).status).toBe(409);
    await getDb().cloudConnection.update({where:{id},data:{leaseUntil:null}});
    let release:(v:typeof ready)=>void=()=>{};
    adapter.collectCloud.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=call(refresh,{method:"POST",user:owner,params:{orgId,id}});
    await vi.waitFor(async()=>expect((await getDb().cloudConnection.findUniqueOrThrow({where:{id}})).syncToken).not.toBeNull());
    expect((await call(disconnect,{method:"DELETE",user:owner,params:{orgId,id}})).status).toBe(200);release(ready);await pending;
    const row=await getDb().cloudConnection.findUniqueOrThrow({where:{id}});expect(row.credentialsEnc).toBeNull();expect(row.status).toBe("DISCONNECTED");
  });
  it("reconnects the same account without duplicating it",async()=>{
    expect((await call(POST,{user:owner,params:{orgId},body:{...body,clientSecret:"new-private-test-secret"}})).status).toBe(200);
    expect(await getDb().cloudConnection.count({where:{organizationId:orgId}})).toBe(1);
  });
});
