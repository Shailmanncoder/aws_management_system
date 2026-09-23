-- CreateTable
CREATE TABLE "business_projects" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_project_accounts" (
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,

    CONSTRAINT "business_project_accounts_pkey" PRIMARY KEY ("organizationId","accountId")
);

-- CreateTable
CREATE TABLE "help_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "requestedById" UUID NOT NULL,
    "assigneeId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_projects_organizationId_idx" ON "business_projects"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "business_projects_organizationId_id_key" ON "business_projects"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "business_project_accounts_accountId_key" ON "business_project_accounts"("accountId");

-- CreateIndex
CREATE INDEX "business_project_accounts_organizationId_projectId_idx" ON "business_project_accounts"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "help_requests_organizationId_status_createdAt_idx" ON "help_requests"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_project_accounts" ADD CONSTRAINT "business_project_accounts_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "business_projects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_project_accounts" ADD CONSTRAINT "business_project_accounts_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "aws_accounts"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
