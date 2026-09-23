import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NormalizedResource } from "@/server/aws/collectors/types";
import type { Prisma } from "@/generated/prisma/client";
import {
  configurationSchema,
  guardrailSchema,
  type Configuration,
  type Review,
} from "@/lib/provisioning";
import { assertCan, authorizeOrg, type OrgAccess } from "@/server/authz/guard";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { awsMode } from "@/server/aws/platform-credentials";
import { notFound } from "@/server/errors";
import { decryptSecret, encryptSecret } from "@/server/security/envelope";
import { generateExternalId } from "@/server/security/crypto";
import {
  assumeRoleSession,
  buildSessionName,
  getCallerIdentity,
} from "@/server/aws/sts";
import type { AwsSession } from "@/server/aws/session";
import { isKnownRegion } from "@/server/aws/regions-catalog";
import { effectiveRegions } from "@/server/aws/regions";
import { insertAudit } from "@/server/repositories/audit-repository";
import { getContext } from "@/server/logging/context";
import { enqueueJob } from "@/server/jobs/queue";
import { buildSearchText } from "@/server/sync/persist";
import {
  preflight,
  locateResource,
  countInstances,
  createResource,
  verifyWithPolling,
} from "./adapters";
import { countVpcs } from "./network";
import { hash, reject, safeAwsError, validateGuardrails } from "./safety";
import { provisionerTemplate } from "./template";

const context = (org: string, id: string) =>
  `provisioner:${org}:${id}:externalId`;
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const audit = (
  a: OrgAccess,
  action: string,
  targetId: string,
  outcome: "SUCCESS" | "FAILURE",
  metadata: Record<string, unknown> = {},
) =>
  insertAudit({
    organizationId: a.organizationId,
    actorUserId: a.userId,
    action,
    targetType: "provisioning",
    targetId,
    outcome,
    requestId: getContext()?.requestId,
    metadata: json(metadata),
  });
async function connection(a: OrgAccess, accountId: string) {
  const c = await getDb().awsConnection.findFirst({
    where: {
      organizationId: a.organizationId,
      awsAccountRefId: accountId,
      awsAccount: { organizationId: a.organizationId },
    },
    include: { awsAccount: true },
  });
  if (!c) throw notFound("AWS connection");
  if (
    c.method !== "ASSUME_ROLE" ||
    !["CONNECTED", "NEEDS_ATTENTION"].includes(c.status) ||
    c.awsAccount.partition !== "aws"
  )
    reject(
      "Provisioning requires a connected AssumeRole account in the standard AWS partition.",
    );
  return c;
}
async function settings(a: OrgAccess) {
  const org = await getDb().organization.findUnique({
    where: { id: a.organizationId },
  });
  if (!org) throw notFound("Workspace");
  return guardrailSchema.parse(org.provisioningGuardrails ?? {});
}
async function sessionFor(
  a: OrgAccess,
  c: Awaited<ReturnType<typeof connection>>,
  allowDisabled = false,
): Promise<AwsSession> {
  if (
    !c.provisionerRoleArn ||
    !c.provisionerExternalIdEnc ||
    (!allowDisabled && !c.provisioningEnabled)
  )
    reject(
      "An administrator must enable the separate provisioning role first.",
    );
  const expected = `arn:aws:iam::${c.awsAccount.awsAccountId}:role/StratusProvisionerRole-${c.id}`;
  if (c.provisionerRoleArn !== expected || c.provisionerRoleArn === c.roleArn)
    reject("The separate provisioning role is invalid.");
  const session = await assumeRoleSession({
    roleArn: expected,
    externalId: await decryptSecret(
      c.provisionerExternalIdEnc,
      context(a.organizationId, c.id),
    ),
    sessionName: buildSessionName("provision", c.id),
    partition: "aws",
    expectedAccountId: c.awsAccount.awsAccountId,
    durationSeconds: 900,
  });
  try {
    const identity = await getCallerIdentity(session);
    if (identity.account !== c.awsAccount.awsAccountId)
      reject("AWS account identity mismatch.");
    return session;
  } catch (e) {
    session.dispose();
    throw safeAwsError(e);
  }
}
export async function provisioningOptions(a: OrgAccess) {
  assertCan(a, "provisioning:create");
  const accounts = await getDb().awsAccount.findMany({
    where: {
      organizationId: a.organizationId,
      connection: {
        provisioningEnabled: true,
        method: "ASSUME_ROLE",
        status: { in: ["CONNECTED", "NEEDS_ATTENTION"] },
      },
    },
    select: {
      id: true,
      displayName: true,
      awsAccountId: true,
      connection: {
        select: { enabledRegions: true, regionAllowlist: true, id: true },
      },
    },
  });
  const network = await getDb().awsResource.findMany({
    where: {
      organizationId: a.organizationId,
      resourceType: { in: ["ec2:vpc", "ec2:subnet", "ec2:security-group"] },
      deletedAt: null,
    },
    select: {
      awsAccountRefId: true,
      resourceId: true,
      resourceType: true,
      name: true,
      region: true,
    },
    take: 1000,
  });
  return {
    network: network.map((n) => ({
      accountId: n.awsAccountRefId,
      id: n.resourceId,
      name: n.name ?? n.resourceId,
      type: n.resourceType,
      region: n.region,
    })),
    guardrails: await settings(a),
    accounts: accounts.map((c) => ({
      id: c.id,
      name: c.displayName,
      awsAccountId: c.awsAccountId,
      regions: effectiveRegions(
        c.connection!.enabledRegions,
        c.connection!.regionAllowlist,
      ),
      bucketPrefix: `stratus-${c.connection!.id}-`,
    })),
  };
}
export async function setupProvisioning(a: OrgAccess, accountId: string) {
  assertCan(a, "provisioning:configure");
  let c = await connection(a, accountId);
  if (!c.provisionerExternalIdEnc) {
    const external = generateExternalId();
    const encrypted = await encryptSecret(
      external,
      context(a.organizationId, c.id),
    );
    await getDb().$transaction(async (tx) => {
      await tx.awsConnection.updateMany({
        where: {
          id: c.id,
          organizationId: a.organizationId,
          provisionerExternalIdEnc: null,
        },
        data: {
          provisionerExternalIdEnc: encrypted,
          provisionerExternalIdHash: hash(external),
          provisionerRoleArn: `arn:aws:iam::${c.awsAccount.awsAccountId}:role/StratusProvisionerRole-${c.id}`,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          actorUserId: a.userId,
          action: "provisioning.setup",
          targetType: "aws_connection",
          targetId: c.id,
          outcome: "SUCCESS",
          requestId: getContext()?.requestId,
        },
      });
    });
    c = await connection(a, accountId);
  }
  const external = await decryptSecret(
    c.provisionerExternalIdEnc!,
    context(a.organizationId, c.id),
  );
  return {
    template: provisionerTemplate(
      getEnv().PLATFORM_AWS_PRINCIPAL_ARN,
      external,
      c.awsAccount.awsAccountId,
      c.id,
      await settings(a),
    ),
    roleArn: c.provisionerRoleArn,
    enabled: c.provisioningEnabled,
  };
}
export async function enableProvisioning(
  a: OrgAccess,
  accountId: string,
  enabled: boolean,
) {
  assertCan(a, "provisioning:configure");
  const c = await connection(a, accountId);
  if (enabled) {
    if (awsMode() !== "live")
      reject("Provisioning is unavailable in fixture mode.");
    const s = await sessionFor(a, c, true);
    s.dispose();
  }
  await getDb().$transaction(async (tx) => {
    await tx.awsConnection.updateMany({
      where: { id: c.id, organizationId: a.organizationId },
      data: { provisioningEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        organizationId: a.organizationId,
        actorUserId: a.userId,
        action: "provisioning.connection_changed",
        targetId: c.id,
        outcome: "SUCCESS",
        metadata: { enabled },
        requestId: getContext()?.requestId,
      },
    });
  });
  return { enabled };
}
export async function updateGuardrails(a: OrgAccess, input: unknown) {
  assertCan(a, "provisioning:configure");
  const g = guardrailSchema.parse(input);
  if (g.allowedRegions.some((r) => !isKnownRegion(r)))
    reject("Select known AWS regions.");
  await getDb().$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: a.organizationId },
      data: { provisioningGuardrails: json(g) },
    });
    await tx.auditLog.create({
      data: {
        organizationId: a.organizationId,
        actorUserId: a.userId,
        action: "provisioning.guardrails_changed",
        outcome: "SUCCESS",
        requestId: getContext()?.requestId,
        metadata: json(g),
      },
    });
  });
  return g;
}
const view = (p: {
  id: string;
  status: string;
  configurationHash: string;
  review: unknown;
  expiresAt: Date;
  resourceId: string | null;
  resultMessage: string | null;
}) => ({
  id: p.id,
  status: p.status,
  configurationHash: p.configurationHash,
  review: p.review,
  expiresAt: p.expiresAt,
  resourceId: p.resourceId,
  resultMessage: p.resultMessage,
});
export async function getPlan(a: OrgAccess, id: string) {
  assertCan(a, "provisioning:create");
  const p = await getDb().provisioningPlan.findFirst({
    where: {
      id,
      organizationId: a.organizationId,
      ...(a.can("provisioning:configure") ? {} : { userId: a.userId }),
    },
  });
  if (!p) throw notFound("Deployment");
  return view(p);
}
export async function makePlan(
  a: OrgAccess,
  input: { idempotencyKey: string; configuration: Configuration },
) {
  assertCan(a, "provisioning:create");
  if (awsMode() !== "live")
    reject(
      "Provisioning is unavailable in fixture mode; no simulated resources will be created.",
    );
  const c = configurationSchema.parse(input.configuration),
    digest = hash(c),
    db = getDb();
  const prior = await db.provisioningPlan.findFirst({
    where: {
      organizationId: a.organizationId,
      userId: a.userId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  if (prior) {
    if (prior.configurationHash !== digest)
      reject("This request key was already used with another configuration.");
    return view(prior);
  }
  const conn = await connection(a, c.accountId),
    g = await settings(a);
  validateGuardrails(
    c,
    g,
    effectiveRegions(conn.enabledRegions, conn.regionAllowlist),
  );
  if (c.service === "s3" && !c.name.startsWith(`stratus-${conn.id}-`))
    reject(
      `Bucket names must start with stratus-${conn.id}- to match the connection's IAM scope.`,
    );
  const id = randomUUID(),
    tags = {
      ...Object.fromEntries(c.tags.map((t) => [t.key, t.value])),
      Name: c.name,
      ManagedBy: "Stratus",
      CreatedBy: a.userId,
      ConnectionId: conn.id,
      Environment: c.environment,
    };
  let session: AwsSession | undefined;
  try {
    session = await sessionFor(a, conn);
    const review = await preflight(session, c, tags, id);
    if (
      c.service === "ec2" &&
      (await countInstances(
        session,
        effectiveRegions(conn.enabledRegions, conn.regionAllowlist),
      )) >= g.maxInstances
    )
      reject("The account has reached the workspace instance limit.");
    if (
      c.service === "vpc" &&
      (await countVpcs(
        session,
        effectiveRegions(conn.enabledRegions, conn.regionAllowlist),
      )) >= g.maxVpcs
    )
      reject("The account has reached the workspace VPC limit.");
    const plan = await db.$transaction(async (tx) => {
      const p = await tx.provisioningPlan.create({
        data: {
          id,
          organizationId: a.organizationId,
          accountId: c.accountId,
          connectionId: conn.id,
          userId: a.userId,
          idempotencyKey: input.idempotencyKey,
          service: c.service,
          configuration: json(c),
          configurationHash: digest,
          review: json(review),
          requestId: getContext()?.requestId ?? randomUUID(),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          actorUserId: a.userId,
          action: "provisioning.planned",
          targetType: c.service,
          targetId: id,
          outcome: "SUCCESS",
          requestId: p.requestId,
          metadata: { connectionId: conn.id, region: c.region },
        },
      });
      return p;
    });
    return view(plan);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const existing = await db.provisioningPlan.findFirst({
        where: {
          organizationId: a.organizationId,
          userId: a.userId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing && existing.configurationHash === digest)
        return view(existing);
    }
    await audit(a, "provisioning.plan_failed", id, "FAILURE", {
      service: c.service,
      region: c.region,
      connectionId: conn.id,
    });
    throw safeAwsError(e);
  } finally {
    session?.dispose();
  }
}
export async function applyPlan(
  a: OrgAccess,
  id: string,
  input: {
    confirmation: string;
    configurationHash: string;
    acknowledgeExposure: boolean;
  },
) {
  // Re-fetch membership even for callers with an old access object.
  a = await authorizeOrg(a.userId, a.organizationId, "provisioning:create");
  if (awsMode() !== "live")
    reject("Provisioning is unavailable in fixture mode.");
  const db = getDb(),
    p = await db.provisioningPlan.findFirst({
      where: { id, organizationId: a.organizationId, userId: a.userId },
    });
  if (!p) throw notFound("Deployment");
  if (p.status !== "PLANNED") return view(p);
  if (p.expiresAt <= new Date())
    reject("This plan has expired. Create and review a new plan.");
  const c = configurationSchema.parse(p.configuration),
    review = p.review as unknown as Review;
  if (
    hash(c) !== p.configurationHash ||
    input.configurationHash !== p.configurationHash ||
    input.confirmation !== c.name
  )
    reject("Plan confirmation does not match.");
  if (c.service === "ec2" && c.publicIpv4 && !input.acknowledgeExposure)
    reject("Explicitly acknowledge public exposure.");
  const conn = await connection(a, c.accountId);
  if (conn.id !== p.connectionId) reject("The account connection has changed.");
  const g = await settings(a),
    regions = effectiveRegions(conn.enabledRegions, conn.regionAllowlist);
  validateGuardrails(c, g, regions);
  // Durable account reservation: one in-flight/ambiguous apply at a time, across every app server.
  await db
    .$transaction(async (tx) => {
      const claimed = await tx.provisioningPlan.updateMany({
        where: {
          id,
          organizationId: a.organizationId,
          userId: a.userId,
          status: "PLANNED",
          expiresAt: { gt: new Date() },
        },
        data: { status: "APPLYING" },
      });
      if (claimed.count !== 1)
        reject("This deployment was already submitted or expired.");
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          actorUserId: a.userId,
          action: "provisioning.apply_started",
          targetType: c.service,
          targetId: id,
          outcome: "SUCCESS",
          requestId: getContext()?.requestId,
          metadata: { connectionId: conn.id, region: c.region },
        },
      });
    })
    .catch(() =>
      reject(
        "Another deployment is in progress or requires reconciliation for this account.",
      ),
    );
  let session: AwsSession | undefined,
    mutating = false;
  try {
    session = await sessionFor(a, conn);
    const current = await preflight(session, c, review.tags, id, review);
    if (
      current.imageId !== review.imageId ||
      current.rootDeviceName !== review.rootDeviceName
    )
      reject("The reviewed image changed. Create a new plan.");
    if (
      c.service === "ec2" &&
      (await countInstances(session, regions)) >= g.maxInstances
    )
      reject("The account has reached the workspace instance limit.");
    if (c.service === "vpc" && (await countVpcs(session, regions)) >= g.maxVpcs)
      reject("The account has reached the workspace VPC limit.");
    // Permission and connection checks run again immediately before the first mutation.
    await authorizeOrg(a.userId, a.organizationId, "provisioning:create");
    const latest = await connection(a, c.accountId);
    if (
      !latest.provisioningEnabled ||
      latest.provisionerRoleArn !== conn.provisionerRoleArn
    )
      reject("Provisioning was disabled or changed.");
    const latestGuardrails = await settings(a);
    validateGuardrails(
      c,
      latestGuardrails,
      effectiveRegions(latest.enabledRegions, latest.regionAllowlist),
    );
    if (
      c.service === "ec2" &&
      latestGuardrails.maxInstances < g.maxInstances &&
      (await countInstances(session, regions)) >= latestGuardrails.maxInstances
    )
      reject("The updated instance limit has been reached.");
    if (p.expiresAt <= new Date())
      reject("Plan expired during preflight. Create a new plan.");
    mutating = true;
    const resourceId = await createResource(
      session,
      c,
      review,
      id,
      async (resourceId) => {
        await db.provisioningPlan.updateMany({
          where: { id, organizationId: a.organizationId, status: "APPLYING" },
          data: { resourceId },
        });
      },
    );
    const resource = await verifyWithPolling(session, c, review, resourceId);
    await finishVerified(a, id, c, conn, resourceId, resource);
    await enqueueJob({
      organizationId: a.organizationId,
      awsAccountRefId: c.accountId,
      type: "INVENTORY_SYNC",
      trigger: "SYSTEM",
      requestedById: a.userId,
    }).catch(() => undefined);
    return getPlan(a, id);
  } catch (e) {
    const error = safeAwsError(e);
    const status = mutating ? "UNKNOWN" : "FAILED";
    await db.$transaction(async (tx) => {
      await tx.provisioningPlan.updateMany({
        where: { id, organizationId: a.organizationId },
        data: {
          status,
          resultMessage: mutating
            ? `${error.publicMessage} Creation may have occurred. An administrator must reconcile this deployment before further creation.`
            : error.publicMessage,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          actorUserId: a.userId,
          action: "provisioning.apply_failed",
          targetType: c.service,
          targetId: id,
          outcome: "FAILURE",
          requestId: getContext()?.requestId,
          metadata: { connectionId: conn.id, region: c.region, status },
        },
      });
    });
    return getPlan(a, id);
  } finally {
    session?.dispose();
  }
}
export const toggleSchema = z.strictObject({ enabled: z.boolean() });

export async function recentPlans(a: OrgAccess) {
  assertCan(a, "provisioning:create");
  return (
    await getDb().provisioningPlan.findMany({
      where: {
        organizationId: a.organizationId,
        ...(a.can("provisioning:configure") ? {} : { userId: a.userId }),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  ).map(view);
}

async function finishVerified(
  a: OrgAccess,
  id: string,
  c: Configuration,
  conn: Awaited<ReturnType<typeof connection>>,
  resourceId: string,
  resource: NormalizedResource,
) {
  const db = getDb();
  await db.$transaction(async (tx) => {
    const data = {
      organizationId: a.organizationId,
      awsAccountRefId: c.accountId,
      resourceType: resource.resourceType,
      region: c.region,
      resourceId,
      arn: resource.arn,
      name: resource.name,
      state: resource.state,
      attributes: json(resource.attributes),
      searchText: buildSearchText(resource, conn.awsAccount.awsAccountId),
      lastSeenAt: new Date(),
      deletedAt: null,
    };
    const r = await tx.awsResource.upsert({
      where: {
        awsAccountRefId_resourceType_region_resourceId: {
          awsAccountRefId: c.accountId,
          resourceType: resource.resourceType,
          region: c.region,
          resourceId,
        },
      },
      create: data,
      update: data,
    });
    await tx.resourceTag.deleteMany({
      where: { organizationId: a.organizationId, resourceRefId: r.id },
    });
    await tx.resourceTag.createMany({
      data: Object.entries(resource.tags).map(([key, value]) => ({
        organizationId: a.organizationId,
        resourceRefId: r.id,
        key,
        value,
      })),
    });
    await tx.organization.update({
      where: { id: a.organizationId },
      data: { inventoryVersion: { increment: 1 } },
    });
    await tx.provisioningPlan.updateMany({
      where: { id, organizationId: a.organizationId },
      data: {
        status: "SUCCEEDED",
        resourceId,
        resultMessage:
          c.service === "ec2"
            ? "Instance verified as pending or running. Inventory refreshed."
            : "Private encrypted bucket verified. Inventory refreshed.",
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: a.organizationId,
        actorUserId: a.userId,
        action: `provisioning.${c.service}.created`,
        targetType: c.service,
        targetId: resourceId,
        outcome: "SUCCESS",
        requestId: getContext()?.requestId,
        metadata: { connectionId: conn.id, region: c.region, planId: id },
      },
    });
  });
}

/** Read-only reconciliation. A partial bucket must first be repaired by its AWS administrator. */
export async function reconcilePlan(a: OrgAccess, id: string) {
  assertCan(a, "provisioning:configure");
  const p = await getDb().provisioningPlan.findFirst({
    where: { id, organizationId: a.organizationId },
  });
  if (!p) throw notFound("Deployment");
  if (!["UNKNOWN", "APPLYING"].includes(p.status)) return view(p);
  if (
    p.status === "APPLYING" &&
    Date.now() - p.updatedAt.getTime() < 30 * 60_000
  )
    reject(
      "This deployment may still be executing. Wait 30 minutes before reconciliation.",
    );

  const c = configurationSchema.parse(p.configuration),
    conn = await connection(a, c.accountId);
  let session: AwsSession | undefined;
  try {
    session = await sessionFor(a, conn, true);
    const resourceId = p.resourceId ?? (await locateResource(session, c, id));
    if (!resourceId) {
      // Original plans expire after 10 minutes; creation sessions last 15. Never release a
      // potentially running request before both windows have elapsed with a safety margin.
      if (Date.now() - p.createdAt.getTime() < 30 * 60_000)
        reject(
          "No resource is visible yet. Wait 30 minutes from planning before reconciling absence.",
        );
      await getDb().$transaction(async (tx) => {
        await tx.provisioningPlan.updateMany({
          where: {
            id,
            organizationId: a.organizationId,
            status: { in: ["UNKNOWN", "APPLYING"] },
          },
          data: {
            status: "FAILED",
            resultMessage:
              "Administrator reconciliation found no resource in AWS after the execution window.",
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: a.organizationId,
            actorUserId: a.userId,
            action: "provisioning.reconciled_absent",
            targetId: id,
            outcome: "SUCCESS",
            requestId: getContext()?.requestId,
          },
        });
      });
      return getPlan(a, id);
    }
    const resource = await verifyWithPolling(
      session,
      c,
      p.review as unknown as Review,
      resourceId,
    );
    await finishVerified(a, id, c, conn, resourceId, resource);
    return getPlan(a, id);
  } catch (e) {
    await audit(a, "provisioning.reconcile_failed", id, "FAILURE");
    throw safeAwsError(e);
  } finally {
    session?.dispose();
  }
}
