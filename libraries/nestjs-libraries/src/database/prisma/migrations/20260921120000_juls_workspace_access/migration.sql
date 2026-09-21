-- AlterEnum
ALTER TYPE "Provider" ADD VALUE 'JULS';

-- CreateTable
CREATE TABLE "JulsWorkspace" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "externalWorkspaceId" TEXT NOT NULL,
    "externalOwnerId" TEXT,
    "organizationId" TEXT,
    "userId" TEXT,
    "oauthAppId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JulsWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JulsBootstrapCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "codeDigest" TEXT NOT NULL,
    "encryptedCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JulsBootstrapCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JulsHandoff" (
    "ticketDigest" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "JulsHandoff_pkey" PRIMARY KEY ("ticketDigest")
);

-- CreateTable
CREATE TABLE "JulsRequestNonce" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JulsRequestNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "JulsAuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JulsAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JulsWorkspace_organizationId_key" ON "JulsWorkspace"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "JulsWorkspace_userId_key" ON "JulsWorkspace"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JulsWorkspace_issuer_externalWorkspaceId_key" ON "JulsWorkspace"("issuer", "externalWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "JulsBootstrapCode_codeDigest_key" ON "JulsBootstrapCode"("codeDigest");

-- CreateIndex
CREATE INDEX "JulsBootstrapCode_expiresAt_idx" ON "JulsBootstrapCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "JulsBootstrapCode_workspaceId_requestId_key" ON "JulsBootstrapCode"("workspaceId", "requestId");

-- CreateIndex
CREATE INDEX "JulsHandoff_expiresAt_idx" ON "JulsHandoff"("expiresAt");

-- CreateIndex
CREATE INDEX "JulsRequestNonce_expiresAt_idx" ON "JulsRequestNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "JulsAuditEvent_workspaceId_createdAt_idx" ON "JulsAuditEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "JulsWorkspace" ADD CONSTRAINT "JulsWorkspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JulsWorkspace" ADD CONSTRAINT "JulsWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JulsBootstrapCode" ADD CONSTRAINT "JulsBootstrapCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "JulsWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JulsBootstrapCode" ADD CONSTRAINT "JulsBootstrapCode_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "OAuthAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JulsHandoff" ADD CONSTRAINT "JulsHandoff_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "JulsWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JulsAuditEvent" ADD CONSTRAINT "JulsAuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "JulsWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
