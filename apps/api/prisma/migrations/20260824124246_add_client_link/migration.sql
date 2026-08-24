-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('UNUSED', 'USED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "assignedById" TEXT;

-- CreateTable
CREATE TABLE "ClientLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "clientName" TEXT,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "status" "LinkStatus" NOT NULL DEFAULT 'UNUSED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "caseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientLink_token_key" ON "ClientLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ClientLink_caseId_key" ON "ClientLink"("caseId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLink" ADD CONSTRAINT "ClientLink_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLink" ADD CONSTRAINT "ClientLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
