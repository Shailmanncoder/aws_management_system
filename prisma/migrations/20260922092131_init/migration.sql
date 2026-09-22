-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'BILLING_VIEWER', 'SECURITY_VIEWER');

-- CreateEnum
CREATE TYPE "ConnectionMethod" AS ENUM ('ASSUME_ROLE', 'ACCESS_KEY');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'PERMISSION_PROBLEM', 'CONNECTION_FAILED', 'ROLE_UNAVAILABLE', 'NEEDS_ATTENTION', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('NEVER', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CostGranularity" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CostDimension" AS ENUM ('TOTAL', 'SERVICE', 'REGION', 'LINKED_ACCOUNT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "FindingSource" AS ENUM ('STRATUS_RULE', 'GUARDDUTY', 'SECURITY_HUB');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "DataBasis" AS ENUM ('CONFIRMED', 'HEURISTIC', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('COST_THRESHOLD', 'COST_ANOMALY', 'PUBLIC_EXPOSURE', 'NEW_SECURITY_FINDING', 'EC2_STOPPED', 'SYNC_FAILURE', 'CONFIG_CHANGE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INVENTORY_SYNC', 'COST_SYNC', 'METRICS_COLLECTION', 'SECURITY_SCAN', 'OPTIMIZATION_ANALYSIS', 'ALERT_EVALUATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING_CONFIRMATION', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "inventoryVersion" INTEGER NOT NULL DEFAULT 0,
    "actionModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aws_accounts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountId" VARCHAR(12) NOT NULL,
    "displayName" TEXT NOT NULL,
    "partition" TEXT NOT NULL DEFAULT 'aws',
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncState" NOT NULL DEFAULT 'NEVER',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aws_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aws_connections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID NOT NULL,
    "method" "ConnectionMethod" NOT NULL DEFAULT 'ASSUME_ROLE',
    "roleArn" TEXT,
    "actionRoleArn" TEXT,
    "externalIdEnc" TEXT NOT NULL,
    "accessKeyIdEnc" TEXT,
    "secretAccessKeyEnc" TEXT,
    "accessKeyHint" TEXT,
    "credentialRotatedAt" TIMESTAMP(3),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "diagnostics" JSONB,
    "enabledRegions" TEXT[],
    "regionAllowlist" TEXT[],
    "lastValidatedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aws_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aws_resources" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "arn" TEXT,
    "name" TEXT,
    "state" TEXT,
    "attributes" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aws_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_tags" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "resourceRefId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "resource_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_summaries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "resourceRefId" UUID NOT NULL,
    "metricName" TEXT NOT NULL,
    "statistic" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "value" DOUBLE PRECISION,
    "datapoints" INTEGER NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_records" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID NOT NULL,
    "granularity" "CostGranularity" NOT NULL,
    "periodStart" DATE NOT NULL,
    "dimension" "CostDimension" NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "estimated" BOOLEAN NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_findings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID NOT NULL,
    "resourceRefId" UUID,
    "source" "FindingSource" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "remediation" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimization_findings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID NOT NULL,
    "resourceRefId" UUID,
    "ruleId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "impact" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "dataBasis" "DataBasis" NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "estimatedMonthlySavings" DECIMAL(14,2),
    "savingsCurrency" TEXT,
    "region" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "optimization_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleId" UUID,
    "awsAccountRefId" UUID,
    "type" "AlertType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorUserId" UUID,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "awsAccountRefId" UUID,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "JobTrigger" NOT NULL,
    "requestedById" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "progress" JSONB,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "resourceRefId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "requestedById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmationHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resultMessage" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

-- CreateIndex
CREATE INDEX "two_factors_userId_idx" ON "two_factors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_email_idx" ON "invitations"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "aws_accounts_organizationId_awsAccountId_key" ON "aws_accounts"("organizationId", "awsAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "aws_accounts_organizationId_id_key" ON "aws_accounts"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "aws_connections_awsAccountRefId_key" ON "aws_connections"("awsAccountRefId");

-- CreateIndex
CREATE INDEX "aws_connections_organizationId_status_idx" ON "aws_connections"("organizationId", "status");

-- CreateIndex
CREATE INDEX "aws_resources_organizationId_resourceType_deletedAt_idx" ON "aws_resources"("organizationId", "resourceType", "deletedAt");

-- CreateIndex
CREATE INDEX "aws_resources_organizationId_region_idx" ON "aws_resources"("organizationId", "region");

-- CreateIndex
CREATE INDEX "aws_resources_organizationId_awsAccountRefId_resourceType_idx" ON "aws_resources"("organizationId", "awsAccountRefId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "aws_resources_awsAccountRefId_resourceType_region_resourceI_key" ON "aws_resources"("awsAccountRefId", "resourceType", "region", "resourceId");

-- CreateIndex
CREATE INDEX "resource_tags_organizationId_key_value_idx" ON "resource_tags"("organizationId", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "resource_tags_resourceRefId_key_key" ON "resource_tags"("resourceRefId", "key");

-- CreateIndex
CREATE INDEX "metric_summaries_organizationId_idx" ON "metric_summaries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_summaries_resourceRefId_metricName_statistic_periodD_key" ON "metric_summaries"("resourceRefId", "metricName", "statistic", "periodDays");

-- CreateIndex
CREATE INDEX "cost_records_organizationId_granularity_dimension_periodSta_idx" ON "cost_records"("organizationId", "granularity", "dimension", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "cost_records_awsAccountRefId_granularity_periodStart_dimens_key" ON "cost_records"("awsAccountRefId", "granularity", "periodStart", "dimension", "dimensionKey");

-- CreateIndex
CREATE INDEX "security_findings_organizationId_status_severity_idx" ON "security_findings"("organizationId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "security_findings_organizationId_fingerprint_key" ON "security_findings"("organizationId", "fingerprint");

-- CreateIndex
CREATE INDEX "optimization_findings_organizationId_status_category_idx" ON "optimization_findings"("organizationId", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "optimization_findings_organizationId_fingerprint_key" ON "optimization_findings"("organizationId", "fingerprint");

-- CreateIndex
CREATE INDEX "alert_rules_organizationId_type_enabled_idx" ON "alert_rules"("organizationId", "type", "enabled");

-- CreateIndex
CREATE INDEX "alerts_organizationId_status_createdAt_idx" ON "alerts"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_organizationId_dedupeKey_key" ON "alerts"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_jobs_status_runAfter_idx" ON "sync_jobs"("status", "runAfter");

-- CreateIndex
CREATE INDEX "sync_jobs_organizationId_createdAt_idx" ON "sync_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "action_requests_organizationId_createdAt_idx" ON "action_requests"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_accounts" ADD CONSTRAINT "aws_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_connections" ADD CONSTRAINT "aws_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_connections" ADD CONSTRAINT "aws_connections_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_resources" ADD CONSTRAINT "aws_resources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_resources" ADD CONSTRAINT "aws_resources_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_resourceRefId_fkey" FOREIGN KEY ("resourceRefId") REFERENCES "aws_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_summaries" ADD CONSTRAINT "metric_summaries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_summaries" ADD CONSTRAINT "metric_summaries_resourceRefId_fkey" FOREIGN KEY ("resourceRefId") REFERENCES "aws_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_resourceRefId_fkey" FOREIGN KEY ("resourceRefId") REFERENCES "aws_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimization_findings" ADD CONSTRAINT "optimization_findings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimization_findings" ADD CONSTRAINT "optimization_findings_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimization_findings" ADD CONSTRAINT "optimization_findings_resourceRefId_fkey" FOREIGN KEY ("resourceRefId") REFERENCES "aws_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_awsAccountRefId_fkey" FOREIGN KEY ("awsAccountRefId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Hand-written hardening (not expressible in Prisma schema) ───────────────────────────

-- Global search: trigram index over normalised search text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "aws_resources_searchText_trgm_idx" ON "aws_resources" USING GIN ("searchText" gin_trgm_ops);

-- At most ONE active (queued or running) job per (account, type): duplicate concurrent syncs are
-- impossible even under racing API requests or multiple workers.
CREATE UNIQUE INDEX "sync_jobs_one_active_per_account_type"
  ON "sync_jobs" ("awsAccountRefId", "type")
  WHERE "status" IN ('QUEUED', 'RUNNING') AND "awsAccountRefId" IS NOT NULL;
CREATE UNIQUE INDEX "sync_jobs_one_active_per_org_type_without_account"
  ON "sync_jobs" ("organizationId", "type")
  WHERE "status" IN ('QUEUED', 'RUNNING') AND "awsAccountRefId" IS NULL;

-- Data integrity.
ALTER TABLE "aws_accounts" ADD CONSTRAINT "aws_accounts_account_id_format" CHECK ("awsAccountId" ~ '^[0-9]{12}$');
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_amount_finite" CHECK ("amount" > -1000000000000 AND "amount" < 1000000000000);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$');

-- Tenant consistency: a connection/resource/cost row must belong to the same org as its AWS account.
ALTER TABLE "aws_connections" ADD CONSTRAINT "aws_connections_account_same_org"
  FOREIGN KEY ("organizationId", "awsAccountRefId") REFERENCES "aws_accounts" ("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "aws_resources" ADD CONSTRAINT "aws_resources_account_same_org"
  FOREIGN KEY ("organizationId", "awsAccountRefId") REFERENCES "aws_accounts" ("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_account_same_org"
  FOREIGN KEY ("organizationId", "awsAccountRefId") REFERENCES "aws_accounts" ("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_account_same_org"
  FOREIGN KEY ("organizationId", "awsAccountRefId") REFERENCES "aws_accounts" ("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "optimization_findings" ADD CONSTRAINT "optimization_findings_account_same_org"
  FOREIGN KEY ("organizationId", "awsAccountRefId") REFERENCES "aws_accounts" ("organizationId", "id") ON DELETE CASCADE;

-- Append-only audit log: normal application paths cannot modify or delete audit history.
-- (Organization deletion sets organizationId to NULL via FK; that single column change is allowed.)
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF (NEW.id, NEW."actorType", NEW.action, NEW."targetType", NEW."targetId", NEW."requestId", NEW.outcome,
      NEW.metadata::text, NEW."ipAddress", NEW."userAgent", NEW."createdAt")
     IS DISTINCT FROM
     (OLD.id, OLD."actorType", OLD.action, OLD."targetType", OLD."targetId", OLD."requestId", OLD.outcome,
      OLD.metadata::text, OLD."ipAddress", OLD."userAgent", OLD."createdAt") THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  -- Only FK-driven nulling of organizationId / actorUserId is permitted.
  IF (NEW."organizationId" IS NOT NULL AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId")
     OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
