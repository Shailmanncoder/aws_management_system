import "server-only";
import {
  EC2Client,
  CreateTagsCommand,
  DeleteTagsCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
  TerminateInstancesCommand,
  ModifyInstanceAttributeCommand,
  MonitorInstancesCommand,
  UnmonitorInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  S3Client,
  PutBucketTaggingCommand,
  DeleteBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  RDSClient,
  AddTagsToResourceCommand,
  RemoveTagsFromResourceCommand,
} from "@aws-sdk/client-rds";
import {
  DynamoDBClient,
  TagResourceCommand as TagDynamoCommand,
  UntagResourceCommand as UntagDynamoCommand,
} from "@aws-sdk/client-dynamodb";
import {
  LambdaClient,
  TagResourceCommand as TagLambdaCommand,
  UntagResourceCommand as UntagLambdaCommand,
} from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { ResourceType } from "@/lib/resource-types";
import { getDb } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import type { OrgAccess } from "@/server/authz/guard";
import { findResource } from "@/server/repositories/resource-repository";
import { withAwsSession } from "@/server/services/aws-session-service";
import { createAwsClient } from "@/server/aws/client-factory";
import { AUDIT } from "@/server/services/audit-service";
import { insertAudit } from "@/server/repositories/audit-repository";
import { getContext } from "@/server/logging/context";
import { buildSearchText } from "@/server/sync/persist";
import type { NormalizedResource } from "@/server/aws/collectors/types";
import type { Prisma } from "@/generated/prisma/client";

export const tagItemSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9 _.:/=+\-@]+$/, "Invalid tag key format.")
    .refine((k) => !k.toLowerCase().startsWith("aws:"), "Tag keys starting with 'aws:' are reserved by AWS."),
  value: z
    .string()
    .trim()
    .max(256)
    .regex(/^[a-zA-Z0-9 _.:/=+\-@]*$/, "Invalid tag value format."),
});

export const updateTagsSchema = z.strictObject({
  tags: z
    .array(tagItemSchema)
    .max(50)
    .refine((tags) => new Set(tags.map((t) => t.key)).size === tags.length, "Tag keys must be unique."),
});

export const ec2ActionSchema = z.strictObject({
  action: z.enum(["start", "stop", "reboot", "terminate"]),
});

export const ec2ModifySchema = z.strictObject({
  instanceType: z.enum(["t3.micro", "t3.small", "t3.medium", "t3.large", "t4g.micro", "t4g.small", "t4g.medium", "m5.large"]).optional(),
  monitoring: z.boolean().optional(),
  securityGroupIds: z.array(z.string().regex(/^sg-[a-f0-9]{8,17}$/)).min(1).max(5).optional(),
});

export const s3ModifySchema = z.strictObject({
  versioning: z.enum(["Enabled", "Suspended"]).optional(),
  encryption: z.enum(["AES256", "aws:kms"]).optional(),
  publicAccessBlock: z
    .strictObject({
      blockPublicAcls: z.boolean(),
      ignorePublicAcls: z.boolean(),
      blockPublicPolicy: z.boolean(),
      restrictPublicBuckets: z.boolean(),
    })
    .optional(),
});

function audit(
  a: OrgAccess,
  action: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
) {
  return insertAudit({
    organizationId: a.organizationId,
    actorUserId: a.userId,
    action,
    targetType: "resource",
    targetId,
    outcome: "SUCCESS",
    requestId: getContext()?.requestId,
    metadata: metadata as Prisma.InputJsonValue,
  });
}

/** Update tags on any resource in AWS and synchronize PostgreSQL. */
export async function updateResourceTags(
  access: OrgAccess,
  resourceId: string,
  input: z.infer<typeof updateTagsSchema>,
) {
  const canRequest = access.can("actions:request") || access.can("provisioning:create");
  if (!canRequest) {
    throw new AppError("FORBIDDEN", "You do not have permission to modify resource tags.");
  }

  const resource = await findResource(access.organizationId, resourceId);
  if (!resource) throw notFound("Resource");

  const existingTags = resource.tags;
  const newTags = input.tags;

  // Execute in AWS via assumed session
  await withAwsSession(access.organizationId, resource.awsAccount.id, "update-tags", async ({ session }) => {
    if (resource.resourceType === "ec2:instance" || resource.resourceType === "ec2:vpc" || resource.resourceType === "ec2:subnet") {
      const client = createAwsClient(EC2Client, session, resource.region, "ec2");
      const newKeys = new Set(newTags.map((t) => t.key));
      const toDelete = existingTags.filter((t) => !newKeys.has(t.key)).map((t) => ({ Key: t.key }));
      if (toDelete.length > 0) {
        await client.send(new DeleteTagsCommand({ Resources: [resource.resourceId], Tags: toDelete }));
      }
      if (newTags.length > 0) {
        await client.send(
          new CreateTagsCommand({
            Resources: [resource.resourceId],
            Tags: newTags.map((t) => ({ Key: t.key, Value: t.value })),
          }),
        );
      }
    } else if (resource.resourceType === "s3:bucket") {
      const client = createAwsClient(S3Client, session, resource.region, "s3");
      if (newTags.length === 0) {
        await client.send(new DeleteBucketTaggingCommand({ Bucket: resource.resourceId }));
      } else {
        await client.send(
          new PutBucketTaggingCommand({
            Bucket: resource.resourceId,
            Tagging: { TagSet: newTags.map((t) => ({ Key: t.key, Value: t.value })) },
          }),
        );
      }
    } else if ((resource.resourceType === "rds:db-instance" || resource.resourceType === "rds:db-cluster") && resource.arn) {
      const client = createAwsClient(RDSClient, session, resource.region, "rds");
      const newKeys = new Set(newTags.map((t) => t.key));
      const toDelete = existingTags.filter((t) => !newKeys.has(t.key)).map((t) => t.key);
      if (toDelete.length > 0) {
        await client.send(new RemoveTagsFromResourceCommand({ ResourceName: resource.arn, TagKeys: toDelete }));
      }
      if (newTags.length > 0) {
        await client.send(
          new AddTagsToResourceCommand({
            ResourceName: resource.arn,
            Tags: newTags.map((t) => ({ Key: t.key, Value: t.value })),
          }),
        );
      }
    } else if (resource.resourceType === "dynamodb:table" && resource.arn) {
      const client = createAwsClient(DynamoDBClient, session, resource.region, "dynamodb");
      const newKeys = new Set(newTags.map((t) => t.key));
      const toDelete = existingTags.filter((t) => !newKeys.has(t.key)).map((t) => t.key);
      if (toDelete.length > 0) {
        await client.send(new UntagDynamoCommand({ ResourceArn: resource.arn, TagKeys: toDelete }));
      }
      if (newTags.length > 0) {
        await client.send(
          new TagDynamoCommand({
            ResourceArn: resource.arn,
            Tags: newTags.map((t) => ({ Key: t.key, Value: t.value })),
          }),
        );
      }
    } else if (resource.resourceType === "lambda:function" && resource.arn) {
      const client = createAwsClient(LambdaClient, session, resource.region, "lambda");
      const newKeys = new Set(newTags.map((t) => t.key));
      const toDelete = existingTags.filter((t) => !newKeys.has(t.key)).map((t) => t.key);
      if (toDelete.length > 0) {
        await client.send(new UntagLambdaCommand({ Resource: resource.arn, TagKeys: toDelete }));
      }
      if (newTags.length > 0) {
        const tagMap = Object.fromEntries(newTags.map((t) => [t.key, t.value]));
        await client.send(new TagLambdaCommand({ Resource: resource.arn, Tags: tagMap }));
      }
    }
  });

  // Update in database
  const db = getDb();
  const nameTag = newTags.find((t) => t.key.toLowerCase() === "name")?.value;
  const updatedName = nameTag !== undefined ? nameTag : resource.name;

  const tagMap = Object.fromEntries(newTags.map((t) => [t.key, t.value]));
  const normalizedForSearch: NormalizedResource = {
    resourceType: resource.resourceType as ResourceType,
    region: resource.region,
    resourceId: resource.resourceId,
    arn: resource.arn,
    name: updatedName,
    state: resource.state,
    tags: tagMap,
    attributes: (resource.attributes as Record<string, unknown>) ?? {},
  };
  const searchText = buildSearchText(normalizedForSearch, resource.awsAccount.awsAccountId);

  await db.$transaction(async (tx) => {
    await tx.resourceTag.deleteMany({
      where: { organizationId: access.organizationId, resourceRefId: resourceId },
    });
    if (newTags.length > 0) {
      await tx.resourceTag.createMany({
        data: newTags.map((t) => ({
          organizationId: access.organizationId,
          resourceRefId: resourceId,
          key: t.key,
          value: t.value,
        })),
      });
    }
    await tx.awsResource.update({
      where: { id: resourceId },
      data: {
        name: updatedName,
        searchText,
        updatedAt: new Date(),
      },
    });
  });

  await audit(access, AUDIT.RESOURCE_TAGGED, resource.id, {
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    previousCount: existingTags.length,
    newCount: newTags.length,
  });

  return { success: true, tags: newTags, name: updatedName };
}

/** Execute lifecycle actions on an EC2 instance (start, stop, reboot, terminate). */
export async function executeEc2Action(
  access: OrgAccess,
  resourceId: string,
  action: "start" | "stop" | "reboot" | "terminate",
) {
  if (action === "terminate") {
    const canTerminate = access.can("org:update") || access.can("actions:configure");
    if (!canTerminate) {
      throw new AppError("FORBIDDEN", "Terminating an EC2 instance requires Administrator or Owner permissions.");
    }
  } else {
    const canRequest = access.can("actions:request") || access.can("provisioning:create");
    if (!canRequest) {
      throw new AppError("FORBIDDEN", "You do not have permission to execute EC2 actions.");
    }
  }

  const resource = await findResource(access.organizationId, resourceId);
  if (!resource) throw notFound("Resource");
  if (resource.resourceType !== "ec2:instance") {
    throw new AppError("VALIDATION_FAILED", "Resource is not an EC2 instance.");
  }

  let nextState = resource.state;

  await withAwsSession(access.organizationId, resource.awsAccount.id, `ec2-${action}`, async ({ session }) => {
    const client = createAwsClient(EC2Client, session, resource.region, "ec2");
    switch (action) {
      case "start":
        await client.send(new StartInstancesCommand({ InstanceIds: [resource.resourceId] }));
        nextState = "pending";
        break;
      case "stop":
        await client.send(new StopInstancesCommand({ InstanceIds: [resource.resourceId] }));
        nextState = "stopping";
        break;
      case "reboot":
        await client.send(new RebootInstancesCommand({ InstanceIds: [resource.resourceId] }));
        nextState = "running";
        break;
      case "terminate":
        await client.send(new TerminateInstancesCommand({ InstanceIds: [resource.resourceId] }));
        nextState = "shutting-down";
        break;
    }
  });

  // Update resource state in DB
  await getDb().awsResource.update({
    where: { id: resourceId },
    data: { state: nextState, updatedAt: new Date() },
  });

  await audit(access, AUDIT.RESOURCE_ACTION, resource.id, {
    action,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    previousState: resource.state,
    newState: nextState,
  });

  return { success: true, action, state: nextState };
}

/** Modify EC2 instance configuration (type, monitoring, security groups). */
export async function modifyEc2Instance(
  access: OrgAccess,
  resourceId: string,
  modifications: z.infer<typeof ec2ModifySchema>,
) {
  const canRequest = access.can("actions:request") || access.can("provisioning:create");
  if (!canRequest) {
    throw new AppError("FORBIDDEN", "You do not have permission to modify EC2 instance configurations.");
  }

  const resource = await findResource(access.organizationId, resourceId);
  if (!resource) throw notFound("Resource");
  if (resource.resourceType !== "ec2:instance") {
    throw new AppError("VALIDATION_FAILED", "Resource is not an EC2 instance.");
  }

  if (modifications.instanceType && resource.state !== "stopped") {
    throw new AppError("PRECONDITION_FAILED", "The EC2 instance must be stopped before changing its instance type.");
  }

  const currentAttrs = (resource.attributes as Record<string, unknown>) ?? {};
  const updatedAttrs = { ...currentAttrs };

  await withAwsSession(access.organizationId, resource.awsAccount.id, "ec2-modify", async ({ session }) => {
    const client = createAwsClient(EC2Client, session, resource.region, "ec2");

    if (modifications.instanceType) {
      await client.send(
        new ModifyInstanceAttributeCommand({
          InstanceId: resource.resourceId,
          InstanceType: { Value: modifications.instanceType },
        }),
      );
      updatedAttrs.instanceType = modifications.instanceType;
    }

    if (modifications.monitoring !== undefined) {
      if (modifications.monitoring) {
        await client.send(new MonitorInstancesCommand({ InstanceIds: [resource.resourceId] }));
        updatedAttrs.monitoring = "enabled";
      } else {
        await client.send(new UnmonitorInstancesCommand({ InstanceIds: [resource.resourceId] }));
        updatedAttrs.monitoring = "disabled";
      }
    }

    if (modifications.securityGroupIds && modifications.securityGroupIds.length > 0) {
      await client.send(
        new ModifyInstanceAttributeCommand({
          InstanceId: resource.resourceId,
          Groups: modifications.securityGroupIds,
        }),
      );
      updatedAttrs.securityGroups = modifications.securityGroupIds.map((id) => ({ id, name: id }));
    }
  });

  await getDb().awsResource.update({
    where: { id: resourceId },
    data: { attributes: updatedAttrs as Prisma.InputJsonValue, updatedAt: new Date() },
  });

  await audit(access, AUDIT.RESOURCE_MODIFIED, resource.id, {
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    modifications,
  });

  return { success: true, attributes: updatedAttrs };
}

/** Modify S3 bucket configuration (versioning, default encryption, public access block). */
export async function modifyS3Bucket(
  access: OrgAccess,
  resourceId: string,
  modifications: z.infer<typeof s3ModifySchema>,
) {
  const canRequest = access.can("actions:request") || access.can("provisioning:create");
  if (!canRequest) {
    throw new AppError("FORBIDDEN", "You do not have permission to modify S3 bucket configurations.");
  }

  const resource = await findResource(access.organizationId, resourceId);
  if (!resource) throw notFound("Resource");
  if (resource.resourceType !== "s3:bucket") {
    throw new AppError("VALIDATION_FAILED", "Resource is not an S3 bucket.");
  }

  const currentAttrs = (resource.attributes as Record<string, unknown>) ?? {};
  const updatedAttrs = { ...currentAttrs };

  await withAwsSession(access.organizationId, resource.awsAccount.id, "s3-modify", async ({ session }) => {
    const client = createAwsClient(S3Client, session, resource.region, "s3");

    if (modifications.versioning) {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: resource.resourceId,
          VersioningConfiguration: { Status: modifications.versioning },
        }),
      );
      updatedAttrs.versioning = modifications.versioning;
    }

    if (modifications.encryption) {
      await client.send(
        new PutBucketEncryptionCommand({
          Bucket: resource.resourceId,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: modifications.encryption,
                },
              },
            ],
          },
        }),
      );
      updatedAttrs.encryption = {
        algorithm: modifications.encryption,
        bucketKeyEnabled: modifications.encryption === "aws:kms",
      };
    }

    if (modifications.publicAccessBlock) {
      await client.send(
        new PutPublicAccessBlockCommand({
          Bucket: resource.resourceId,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: modifications.publicAccessBlock.blockPublicAcls,
            IgnorePublicAcls: modifications.publicAccessBlock.ignorePublicAcls,
            BlockPublicPolicy: modifications.publicAccessBlock.blockPublicPolicy,
            RestrictPublicBuckets: modifications.publicAccessBlock.restrictPublicBuckets,
          },
        }),
      );
      updatedAttrs.publicAccessBlock = {
        blockPublicAcls: modifications.publicAccessBlock.blockPublicAcls,
        ignorePublicAcls: modifications.publicAccessBlock.ignorePublicAcls,
        blockPublicPolicy: modifications.publicAccessBlock.blockPublicPolicy,
        restrictPublicBuckets: modifications.publicAccessBlock.restrictPublicBuckets,
      };
    }
  });

  await getDb().awsResource.update({
    where: { id: resourceId },
    data: { attributes: updatedAttrs as Prisma.InputJsonValue, updatedAt: new Date() },
  });

  await audit(access, AUDIT.RESOURCE_MODIFIED, resource.id, {
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    modifications,
  });

  return { success: true, attributes: updatedAttrs };
}
