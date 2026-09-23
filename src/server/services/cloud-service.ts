import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type CloudConnection } from "@/generated/prisma/client";
import { cloudInput, type CloudInput, type CloudProvider, type CloudConnectionDto, type CloudSnapshot } from "@/lib/cloud";
import { assertCan, type OrgAccess } from "../authz/guard";
import { getDb } from "../db";
import { AppError, conflict, notFound } from "../errors";
import { encryptSecret, decryptSecret } from "../security/envelope";
import { cloudToken, collectCloud, cloudMessage } from "../cloud/adapters";
import { AUDIT, recordAudit } from "./audit-service";

const context = (org: string, id: string) => `cloud:${org}:${id}:credentials`;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function dto(row: CloudConnection, access: OrgAccess): CloudConnectionDto {
  const diagnostics = (row.diagnostics ?? {}) as Record<string,string>;
  return { id:row.id,provider:row.provider as CloudProvider,externalId:row.externalId,displayName:row.displayName,status:row.status,
    inventory:access.can("inventory:read") ? row.inventory as unknown as CloudConnectionDto["inventory"] : null,
    billing:access.can("cost:read") ? row.billing as unknown as CloudConnectionDto["billing"] : null,
    security:access.can("security:read") ? row.security as unknown as CloudConnectionDto["security"] : null,
    diagnostics:Object.fromEntries(Object.entries(diagnostics).filter(([k])=> k === "connection" || access.can(k === "inventory" ? "inventory:read" : k === "billing" ? "cost:read" : "security:read"))),
    inventoryAt:access.can("inventory:read") ? row.inventoryAt?.toISOString() ?? null : null,
    billingAt:access.can("cost:read") ? row.billingAt?.toISOString() ?? null : null,
    securityAt:access.can("security:read") ? row.securityAt?.toISOString() ?? null : null,
    lastAttemptAt:row.lastAttemptAt?.toISOString() ?? null };
}
export async function listCloudConnections(access: OrgAccess, provider?: CloudProvider) {
  assertCan(access,"aws_accounts:read");
  const rows=await getDb().cloudConnection.findMany({where:{organizationId:access.organizationId,...(provider ? {provider}: {})},orderBy:{createdAt:"asc"}});
  return rows.map(row=>dto(row,access));
}
function snapshotUpdate(snapshot: CloudSnapshot) {
  const now=new Date();
  return { status:Object.values(snapshot.diagnostics).every(s=>s === "Ready") ? "CONNECTED" : "NEEDS_ATTENTION",lastAttemptAt:now,diagnostics:asJson(snapshot.diagnostics),
    ...(snapshot.inventory !== null ? {inventory:asJson(snapshot.inventory),inventoryAt:now}:{}),
    ...(snapshot.billing !== null ? {billing:asJson(snapshot.billing),billingAt:now}:{}),
    ...(snapshot.security !== null ? {security:asJson(snapshot.security),securityAt:now}:{}) };
}
export async function connectCloud(access: OrgAccess, input: CloudInput) {
  assertCan(access,"aws_accounts:connect");
  const db=getDb(), externalId=input.provider === "GCP" ? input.projectId : input.subscriptionId.toLowerCase();
  const unique={organizationId:access.organizationId,provider:input.provider,externalId};
  const before=await db.cloudConnection.findUnique({where:{organizationId_provider_externalId:unique},select:{id:true,updatedAt:true}});
  const token=await cloudToken(input), snapshot=await collectCloud(input,token);
  if (snapshot.inventory === null) throw new AppError("PRECONDITION_FAILED",snapshot.diagnostics.inventory);

  const row=await db.$transaction(async tx=>{
    // Lock the workspace to serialize reconnect/disconnect and prevent credential races.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${access.organizationId}::uuid FOR UPDATE`;
    const existing=await tx.cloudConnection.findUnique({where:{organizationId_provider_externalId:unique}});
    if ((existing?.updatedAt.getTime() ?? null) !== (before?.updatedAt.getTime() ?? null)) throw conflict("This connection changed during verification. Reload and try again.");
    if (existing?.leaseUntil && existing.leaseUntil > new Date()) throw conflict("A refresh is running. Wait for it to finish before replacing credentials.");
    const id=existing?.id ?? randomUUID(), credentialsEnc=await encryptSecret(JSON.stringify(input),context(access.organizationId,id));
    const data={displayName:input.displayName,credentialsEnc,...snapshotUpdate(snapshot),syncToken:null,leaseUntil:null};
    if (existing) {
      const updated = await tx.cloudConnection.updateMany({where:{id,updatedAt:existing.updatedAt},data});
      if (!updated.count) throw conflict("This connection changed during verification. Reload and try again.");
      return tx.cloudConnection.findUniqueOrThrow({where:{id}});
    }
    return tx.cloudConnection.create({data:{id,...unique,...data}});
  },{timeout:15000});
  await recordAudit({organizationId:access.organizationId,actorUserId:access.userId,action:AUDIT.CLOUD_CONNECTED,targetType:"cloud_connection",targetId:row.id,outcome:"SUCCESS",metadata:{provider:input.provider}});
  return dto(row,access);
}
export async function refreshCloud(access: OrgAccess, id: string) {
  assertCan(access,"sync:trigger");
  const db=getDb(), syncToken=randomUUID(), now=new Date();
  const row=await db.cloudConnection.findFirst({where:{id,organizationId:access.organizationId}});
  if (!row) throw notFound("Cloud connection");
  if (!row.credentialsEnc) throw new AppError("PRECONDITION_FAILED","Reconnect this account before refreshing.");
  const claimed=await db.cloudConnection.updateMany({where:{id,organizationId:access.organizationId,credentialsEnc:row.credentialsEnc,OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},data:{syncToken,leaseUntil:new Date(now.getTime()+300000),lastAttemptAt:now}});
  if (!claimed.count) throw conflict("A refresh is already running. Try again when it finishes.");
  try {
    const input=cloudInput.parse(JSON.parse(await decryptSecret(row.credentialsEnc,context(access.organizationId,id))));
    const snapshot=await collectCloud(input,await cloudToken(input));
    const updated=await db.cloudConnection.updateMany({where:{id,organizationId:access.organizationId,syncToken},data:{...snapshotUpdate(snapshot),syncToken:null,leaseUntil:null}});
    if (!updated.count) throw conflict("This connection changed during refresh. Reload the page.");
    await recordAudit({organizationId:access.organizationId,actorUserId:access.userId,action:AUDIT.CLOUD_SYNCED,targetType:"cloud_connection",targetId:id,outcome:snapshot.inventory === null ? "FAILURE":"SUCCESS"});
  } catch(err) {
    await db.cloudConnection.updateMany({where:{id,organizationId:access.organizationId,syncToken},data:{status:"NEEDS_ATTENTION",diagnostics:{connection:cloudMessage(err)},syncToken:null,leaseUntil:null}});
    throw new AppError("SERVICE_UNAVAILABLE",cloudMessage(err));
  }
  return dto(await db.cloudConnection.findFirstOrThrow({where:{id,organizationId:access.organizationId}}),access);
}
export async function disconnectCloud(access: OrgAccess, id: string) {
  assertCan(access,"aws_accounts:disconnect");
  const db=getDb();
  const changed=await db.cloudConnection.updateMany({where:{id,organizationId:access.organizationId},data:{credentialsEnc:null,status:"DISCONNECTED",syncToken:null,leaseUntil:null}});
  if (!changed.count) throw notFound("Cloud connection");
  await recordAudit({organizationId:access.organizationId,actorUserId:access.userId,action:AUDIT.CLOUD_DISCONNECTED,targetType:"cloud_connection",targetId:id,outcome:"SUCCESS"});
  return {ok:true};
}
