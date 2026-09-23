import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { uuidSchema } from "@/server/validation/common";
import { findResource } from "@/server/repositories/resource-repository";
import { notFound } from "@/server/errors";
import {
  updateResourceTags,
  updateTagsSchema,
} from "@/server/services/resource-mutation-service";

export const GET = orgRoute(
  {
    operation: "resource.tags.get",
    permission: "inventory:read",
    params: z.strictObject({ id: uuidSchema }),
  },
  async ({ access, params }) => {
    const resource = await findResource(access.organizationId, params.id);
    if (!resource) throw notFound("Resource");
    return { tags: resource.tags };
  },
);

export const PUT = orgRoute(
  {
    operation: "resource.tags.update",
    permission: "actions:request",
    params: z.strictObject({ id: uuidSchema }),
    body: updateTagsSchema,
  },
  async ({ access, params, body }) => {
    return updateResourceTags(access, params.id, body);
  },
);
