import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { uuidSchema } from "@/server/validation/common";
import {
  ec2ActionSchema,
  ec2ModifySchema,
  executeEc2Action,
  modifyEc2Instance,
  modifyS3Bucket,
  s3ModifySchema,
} from "@/server/services/resource-mutation-service";

const actionPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ec2:action"),
    action: ec2ActionSchema.shape.action,
  }),
  z.strictObject({
    type: z.literal("ec2:modify"),
    modifications: ec2ModifySchema,
  }),
  z.strictObject({
    type: z.literal("s3:modify"),
    modifications: s3ModifySchema,
  }),
]);

export const POST = orgRoute(
  {
    operation: "resource.action",
    permission: "actions:request",
    params: z.strictObject({ id: uuidSchema }),
    body: actionPayloadSchema,
  },
  async ({ access, params, body }) => {
    switch (body.type) {
      case "ec2:action":
        return executeEc2Action(access, params.id, body.action);
      case "ec2:modify":
        return modifyEc2Instance(access, params.id, body.modifications);
      case "s3:modify":
        return modifyS3Bucket(access, params.id, body.modifications);
    }
  },
);
