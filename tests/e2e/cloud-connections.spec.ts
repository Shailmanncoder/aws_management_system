import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect,test } from "@playwright/test";
import { newContext,signUp,createWorkspace } from "./helpers";
import { E2E_DB } from "../../playwright.config";

test("provider setup, saved inventory, costs, findings and disconnect",async({browser})=>{
  const ctx=await newContext(browser),page=await ctx.newPage();
  await signUp(page);await createWorkspace(page,"Multi-cloud Studio");
  await page.goto("/cloud/gcp");
  await expect(page.getByRole("heading",{name:"Google Cloud",exact:true})).toBeVisible();
  await expect(page.getByLabel("Service account JSON key")).toBeVisible();
  await page.goto("/cloud/azure");
  await page.getByLabel("Connection name",{exact:true}).fill("Azure Website");
  for(const label of ["Subscription ID","Tenant ID","Application (client) ID"])await page.getByLabel(label,{exact:true}).fill(randomUUID());
  await page.getByLabel("Client secret value").fill("invalid-test-secret");
  await page.route("**/api/v1/orgs/*/cloud-connections",route=>route.fulfill({status:412,json:{error:{message:"Authentication failed. Check the client secret."}}}));
  await page.getByRole("button",{name:"Verify and connect"}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Authentication failed");
  await page.unroute("**/api/v1/orgs/*/cloud-connections");
  const org=(await ctx.cookies()).find(c=>c.name==="stratus_active_org")!.value;
  // Seed only the isolated browser-test database, never a deployed provider account.
  if(!new URL(E2E_DB).pathname.endsWith("stratus_e2e"))throw new Error("Unsafe test database");
  const db=new Pool({connectionString:E2E_DB});
  const today=new Date().toISOString().slice(0,10);
  try{
    await db.query('INSERT INTO cloud_connections (id,"organizationId",provider,"externalId","displayName","credentialsEnc",inventory,billing,security,diagnostics,"inventoryAt","billingAt","securityAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),now(),now())',[randomUUID(),org,"AZURE",randomUUID(),"Azure Website","test-only-unusable-credential",JSON.stringify([{id:"vm-1",name:"Website VM",type:"Microsoft.Compute/virtualMachines",region:"eastus"}]),JSON.stringify([{day:today,amount:12,currency:"USD"}]),JSON.stringify([{id:"issue-1",title:"Protect the virtual machine",severity:"HIGH",resource:"vm-1"}]),JSON.stringify({inventory:"Ready",billing:"Ready",security:"Ready"})]);
  }finally{await db.end();}
  await page.reload();
  await expect(page.getByRole("cell",{name:/Website VM/})).toBeVisible();
  await page.getByLabel("Search cloud resources").fill("no-match");
  await expect(page.getByText("0 matching resources.",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Spending",exact:true}).click();
  await expect(page.getByRole("img",{name:/Cloud spending/})).toBeVisible();
  await page.getByRole("button",{name:"Security",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Protect the virtual machine"})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/screens/azure-mobile.png",fullPage:true});
  await page.getByText("Disconnect",{exact:true}).click();
  await page.getByRole("button",{name:"Confirm disconnect"}).click();
  await expect(page.getByText(/Historical data only/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Refresh cloud data"})).toHaveCount(0);
  await ctx.close();
});
