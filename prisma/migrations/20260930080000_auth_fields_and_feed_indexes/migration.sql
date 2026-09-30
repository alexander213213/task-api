-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE', 'BOTH');

-- AlterTable User: nullable passwordHash (Google-only accounts), link fields
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "provider" "AuthProvider" NOT NULL DEFAULT 'PASSWORD';
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- AlterTable RefreshToken: rotation fields (nullable first for backfill)
ALTER TABLE "RefreshToken" ADD COLUMN "jti" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "ip" TEXT;

-- Backfill existing sessions: stable random jti, 7-day expiry from issue time
UPDATE "RefreshToken"
SET "jti" = gen_random_uuid()::text,
    "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "jti" IS NULL;

ALTER TABLE "RefreshToken" ALTER COLUMN "jti" SET NOT NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE UNIQUE INDEX "RefreshToken_jti_key" ON "RefreshToken"("jti");
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- AlterTable Review: updatedAt backfilled from createdAt
ALTER TABLE "Review" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Review" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "Review" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Feed and relation indexes
CREATE INDEX "Task_status_deadline_idx" ON "Task"("status", "deadline");
CREATE INDEX "Task_status_reward_idx" ON "Task"("status", "reward");
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");
CREATE INDEX "Task_title_idx" ON "Task"("title");
CREATE INDEX "Proposal_taskId_createdAt_idx" ON "Proposal"("taskId", "createdAt");
