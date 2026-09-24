CREATE TABLE "workspace_records" (
 "id" UUID PRIMARY KEY, "organizationId" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "shared" BOOLEAN NOT NULL DEFAULT true, "resourceId" UUID REFERENCES "aws_resources"("id") ON DELETE CASCADE,
 "payload" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "workspace_records_organizationId_kind_updatedAt_idx" ON "workspace_records"("organizationId", "kind", "updatedAt");
CREATE INDEX "workspace_records_organizationId_resourceId_idx" ON "workspace_records"("organizationId", "resourceId");
CREATE TABLE "resource_changes" (
 "id" UUID PRIMARY KEY, "organizationId" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "resourceId" UUID NOT NULL REFERENCES "aws_resources"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL, "before" JSONB, "after" JSONB, "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "resource_changes_organizationId_resourceId_observedAt_idx" ON "resource_changes"("organizationId", "resourceId", "observedAt");
CREATE TABLE "operation_plans" (
 "id" UUID PRIMARY KEY, "organizationId" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "name" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "approvedBy" UUID REFERENCES "users"("id") ON DELETE SET NULL,
 "approvedAt" TIMESTAMP(3), "scheduledAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL,
 "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "operation_plans_organizationId_status_scheduledAt_idx" ON "operation_plans"("organizationId", "status", "scheduledAt");
CREATE TABLE "notification_deliveries" (
 "id" UUID PRIMARY KEY, "organizationId" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "subscriptionId" UUID NOT NULL REFERENCES "workspace_records"("id") ON DELETE CASCADE,
 "eventId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "message" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "notification_deliveries_organizationId_subscriptionId_eventId_key" ON "notification_deliveries"("organizationId", "subscriptionId", "eventId");
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");
