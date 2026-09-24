import "server-only";
import type { WriteFence } from "../jobs/lease";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { ResourceType } from "@/lib/resource-types";
import type { NormalizedResource } from "../aws/collectors/types";
import { changedFields, resourceSnapshot } from "@/lib/operations";
import { getDb } from "../db";

const BATCH = 200;

export function buildSearchText(r: NormalizedResource, awsAccountId: string): string {
  const parts = [
    r.name,
    r.resourceId,
    r.arn,
    r.region,
    r.resourceType,
    r.state,
    awsAccountId,
    ...(r.searchTerms ?? []),
    ...Object.entries(r.tags).flatMap(([k, v]) => [k, v, `${k}=${v}`]),
  ];
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ")
    .toLowerCase()
    .slice(0, 4000);
}

export interface PersistScope {
  organizationId: string;
  awsAccountRefId: string;
  awsAccountId: string;
}

/**
 * Upserts a successful collector's output and marks previously-seen resources of the same
 * (type[, region]) that were NOT observed this run as deleted. Called only for collectors that
 * succeeded, so a failing region/service never causes data loss.
 */
export async function persistCollectorResult(
  scope: PersistScope,
  result: { resources: NormalizedResource[]; resourceTypes: ResourceType[]; region: string | null },
  syncStartedAt: Date,
  fence?: WriteFence,
): Promise<{ upserted: number; markedDeleted: number }> {
  const db = getDb();
  const now = new Date();
  let upserted = 0;

  for (let i = 0; i < result.resources.length; i += BATCH) {
    const chunk = result.resources.slice(i, i + BATCH);
    // De-duplicate inside the chunk (ON CONFLICT cannot touch the same row twice).
    const unique = [...new Map(chunk.map((r) => [`${r.resourceType}|${r.region}|${r.resourceId}`, r])).values()];
    const values = unique.map(
      (r) => Prisma.sql`(${randomUUID()}::uuid, ${scope.organizationId}::uuid, ${scope.awsAccountRefId}::uuid, ${r.resourceType}, ${r.region}, ${r.resourceId},
        ${r.arn}, ${r.name}, ${r.state}, ${JSON.stringify(r.attributes)}::jsonb, ${buildSearchText(r, scope.awsAccountId)}, ${now}, ${now}, NULL, ${now}, ${now})`,
    );
    await db.$transaction(async (tx) => {
    await fence?.(tx);
    const previous = await tx.awsResource.findMany({ where: {
      organizationId: scope.organizationId, awsAccountRefId: scope.awsAccountRefId,
      OR: unique.map(r => ({ resourceType: r.resourceType, region: r.region, resourceId: r.resourceId })),
    }, include: { tags: true } });
    const beforeByKey = new Map(previous.map(r => [`${r.resourceType}|${r.region}|${r.resourceId}`, resourceSnapshot(r)]));
    await tx.$executeRaw`
      INSERT INTO "aws_resources" ("id", "organizationId", "awsAccountRefId", "resourceType", "region", "resourceId",
        "arn", "name", "state", "attributes", "searchText", "firstSeenAt", "lastSeenAt", "deletedAt", "createdAt", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("awsAccountRefId", "resourceType", "region", "resourceId") DO UPDATE SET
        "arn" = EXCLUDED."arn", "name" = EXCLUDED."name", "state" = EXCLUDED."state", "attributes" = EXCLUDED."attributes",
        "searchText" = EXCLUDED."searchText", "lastSeenAt" = EXCLUDED."lastSeenAt", "deletedAt" = NULL, "updatedAt" = EXCLUDED."updatedAt"`;
    upserted += unique.length;

    // Replace tags for this chunk (tenant-scoped lookup of the upserted ids).
    const rows = await tx.awsResource.findMany({
      where: {
        organizationId: scope.organizationId,
        awsAccountRefId: scope.awsAccountRefId,
        OR: unique.map((r) => ({ resourceType: r.resourceType, region: r.region, resourceId: r.resourceId })),
      },
      select: { id: true, resourceType: true, region: true, resourceId: true },
    });
    const idByKey = new Map(rows.map((r) => [`${r.resourceType}|${r.region}|${r.resourceId}`, r.id]));
    const ids = [...idByKey.values()];
    const tagRows = unique.flatMap((r) => {
      const id = idByKey.get(`${r.resourceType}|${r.region}|${r.resourceId}`);
      return id ? Object.entries(r.tags).map(([key, value]) => ({ organizationId: scope.organizationId, resourceRefId: id, key, value })) : [];
    });
    await tx.resourceTag.deleteMany({ where: { organizationId: scope.organizationId, resourceRefId: { in: ids } } });
    await tx.resourceTag.createMany({ data: tagRows, skipDuplicates: true });
    for (const r of unique) {
      const key = `${r.resourceType}|${r.region}|${r.resourceId}`;
      const before = beforeByKey.get(key);
      const after = resourceSnapshot({ ...r, tags: Object.entries(r.tags).map(([key, value]) => ({ key, value })) });
      if (!before || changedFields(before, after).length) await tx.resourceChange.create({ data: {
        organizationId: scope.organizationId, resourceId: idByKey.get(key)!,
        kind: !before ? "DISCOVERED" : before.deleted ? "REAPPEARED" : "CHANGED",
        before: before ? JSON.parse(JSON.stringify(before)) : Prisma.JsonNull,
        after: JSON.parse(JSON.stringify(after)), observedAt: now,
      } });
    }
    }, { timeout: 30000 });
  }

  // Stale marking: anything of these types (in this region, for regional collectors) that was
  // not refreshed during this sync run no longer exists in AWS.
  const stale = await db.$transaction(async (tx) => {
    await fence?.(tx);
    const staleWhere = {
      organizationId: scope.organizationId,
      awsAccountRefId: scope.awsAccountRefId,
      resourceType: { in: result.resourceTypes },
      ...(result.region ? { region: result.region } : {}),
      deletedAt: null,
      lastSeenAt: { lt: syncStartedAt },
    };
    let count = 0;
    for (;;) {
      const deleted = await tx.awsResource.findMany({ where: staleWhere, include: { tags: true }, take: BATCH, orderBy: { id: "asc" } });
      if (!deleted.length) break;
      await tx.resourceChange.createMany({ data: deleted.map(r => ({
        organizationId: scope.organizationId, resourceId: r.id, kind: "DELETED",
        before: JSON.parse(JSON.stringify(resourceSnapshot(r))), after: Prisma.JsonNull, observedAt: now,
      })) });
      const changed = await tx.awsResource.updateMany({ where: { ...staleWhere, id: { in: deleted.map(r => r.id) } }, data: { deletedAt: now } });
      count += changed.count;
    }
    return { count };
  });
  return { upserted, markedDeleted: stale.count };
}
