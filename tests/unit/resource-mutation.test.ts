import { describe, expect, it } from "vitest";
import {
  ec2ActionSchema,
  ec2ModifySchema,
  s3ModifySchema,
  tagItemSchema,
  updateTagsSchema,
} from "@/server/services/resource-mutation-service";

describe("Resource mutation schemas and validation", () => {
  describe("Tag validation", () => {
    it("accepts valid alphanumeric and symbol tags", () => {
      const valid = tagItemSchema.safeParse({ key: "Environment", value: "Production-01" });
      expect(valid.success).toBe(true);
    });

    it("rejects reserved 'aws:' prefix in tag keys", () => {
      const lower = tagItemSchema.safeParse({ key: "aws:cloudformation:stack-name", value: "demo" });
      expect(lower.success).toBe(false);
      const upper = tagItemSchema.safeParse({ key: "AWS:Owner", value: "dev" });
      expect(upper.success).toBe(false);
    });

    it("rejects empty tag keys", () => {
      const empty = tagItemSchema.safeParse({ key: "   ", value: "test" });
      expect(empty.success).toBe(false);
    });

    it("rejects duplicate tag keys in a single update", () => {
      const dup = updateTagsSchema.safeParse({
        tags: [
          { key: "Team", value: "Engineering" },
          { key: "team", value: "Product" }, // case-sensitive check
          { key: "Team", value: "Operations" }, // duplicate
        ],
      });
      expect(dup.success).toBe(false);
    });

    it("accepts up to 50 unique tags", () => {
      const tags = Array.from({ length: 50 }, (_, i) => ({
        key: `tag-${i}`,
        value: `val-${i}`,
      }));
      expect(updateTagsSchema.safeParse({ tags }).success).toBe(true);

      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        key: `tag-${i}`,
        value: `val-${i}`,
      }));
      expect(updateTagsSchema.safeParse({ tags: tooMany }).success).toBe(false);
    });
  });

  describe("EC2 lifecycle action schema", () => {
    it("accepts valid actions", () => {
      for (const action of ["start", "stop", "reboot", "terminate"] as const) {
        expect(ec2ActionSchema.safeParse({ action }).success).toBe(true);
      }
    });

    it("rejects unknown or invalid actions", () => {
      expect(ec2ActionSchema.safeParse({ action: "pause" }).success).toBe(false);
      expect(ec2ActionSchema.safeParse({ action: "destroy" }).success).toBe(false);
    });
  });

  describe("EC2 modification schema", () => {
    it("validates allowed instance types", () => {
      expect(ec2ModifySchema.safeParse({ instanceType: "t3.small" }).success).toBe(true);
      expect(ec2ModifySchema.safeParse({ instanceType: "t4g.micro" }).success).toBe(true);
      expect(ec2ModifySchema.safeParse({ instanceType: "x1.32xlarge" }).success).toBe(false);
    });

    it("validates security group IDs", () => {
      expect(ec2ModifySchema.safeParse({ securityGroupIds: ["sg-1234567890abcdef0"] }).success).toBe(true);
      expect(ec2ModifySchema.safeParse({ securityGroupIds: ["invalid-sg"] }).success).toBe(false);
    });

    it("accepts detailed monitoring boolean flag", () => {
      expect(ec2ModifySchema.safeParse({ monitoring: true }).success).toBe(true);
      expect(ec2ModifySchema.safeParse({ monitoring: false }).success).toBe(true);
    });
  });

  describe("S3 modification schema", () => {
    it("validates bucket versioning states", () => {
      expect(s3ModifySchema.safeParse({ versioning: "Enabled" }).success).toBe(true);
      expect(s3ModifySchema.safeParse({ versioning: "Suspended" }).success).toBe(true);
      expect(s3ModifySchema.safeParse({ versioning: "Disabled" }).success).toBe(false);
    });

    it("validates server-side encryption algorithm", () => {
      expect(s3ModifySchema.safeParse({ encryption: "AES256" }).success).toBe(true);
      expect(s3ModifySchema.safeParse({ encryption: "aws:kms" }).success).toBe(true);
      expect(s3ModifySchema.safeParse({ encryption: "RSA" }).success).toBe(false);
    });

    it("validates public access block configuration", () => {
      expect(
        s3ModifySchema.safeParse({
          publicAccessBlock: {
            blockPublicAcls: true,
            ignorePublicAcls: true,
            blockPublicPolicy: true,
            restrictPublicBuckets: true,
          },
        }).success,
      ).toBe(true);
    });
  });
});
