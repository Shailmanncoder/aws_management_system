CREATE TABLE "cloud_connections" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('GCP','AZURE')),
  "externalId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "credentialsEnc" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "inventory" JSONB, "billing" JSONB, "security" JSONB, "diagnostics" JSONB,
  "lastAttemptAt" TIMESTAMP(3), "inventoryAt" TIMESTAMP(3), "billingAt" TIMESTAMP(3), "securityAt" TIMESTAMP(3),
  "syncToken" UUID, "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cloud_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cloud_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_connections_organizationId_provider_externalId_key" ON "cloud_connections"("organizationId", "provider", "externalId");
CREATE INDEX "cloud_connections_organizationId_provider_idx" ON "cloud_connections"("organizationId", "provider");
