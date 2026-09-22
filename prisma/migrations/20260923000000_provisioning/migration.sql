ALTER TYPE "OrgRole" ADD VALUE 'PROVISIONER';
ALTER TABLE "organizations" ADD COLUMN "provisioningGuardrails" JSONB;
ALTER TABLE "aws_connections" ADD COLUMN "provisionerRoleArn" TEXT, ADD COLUMN "provisionerExternalIdEnc" TEXT, ADD COLUMN "provisionerExternalIdHash" TEXT, ADD COLUMN "provisioningEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "aws_connections_provisionerExternalIdHash_key" ON "aws_connections"("provisionerExternalIdHash");
CREATE TABLE "provisioning_plans" (
"id" UUID NOT NULL, "organizationId" UUID NOT NULL, "accountId" UUID NOT NULL, "connectionId" UUID NOT NULL, "userId" UUID NOT NULL, "idempotencyKey" UUID NOT NULL,
"service" TEXT NOT NULL, "configuration" JSONB NOT NULL, "configurationHash" TEXT NOT NULL, "review" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PLANNED', "resourceId" TEXT, "resultMessage" TEXT, "requestId" TEXT NOT NULL,
"expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "provisioning_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provisioning_plans_org_user_key" ON "provisioning_plans"("organizationId", "userId", "idempotencyKey");
CREATE INDEX "provisioning_plans_org_account_status" ON "provisioning_plans"("organizationId", "accountId", "status");
CREATE UNIQUE INDEX "provisioning_one_active_account" ON "provisioning_plans"("organizationId", "accountId") WHERE "status" IN ('APPLYING', 'UNKNOWN');
