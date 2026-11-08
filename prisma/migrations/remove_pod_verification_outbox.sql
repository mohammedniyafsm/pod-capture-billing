-- DropForeignKey
ALTER TABLE "PodVerificationOutbox" DROP CONSTRAINT IF EXISTS "PodVerificationOutbox_submissionId_fkey";

-- DropTable
DROP TABLE IF EXISTS "PodVerificationOutbox";

-- DropEnum
DROP TYPE IF EXISTS "PodVerificationOutboxStatus";

