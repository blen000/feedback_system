-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT "Issue_assigneeId_fkey";
-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT "Issue_branchId_fkey";
-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT "Issue_departmentId_fkey";
-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT "Issue_feedbackId_fkey";
-- DropTable
DROP TABLE "Issue";
-- DropEnum
DROP TYPE "IssueStatus";
-- CreateTable
CREATE TABLE "FeedbackForward" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "note" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackForward_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "FeedbackForward_toUserId_readAt_idx" ON "FeedbackForward"("toUserId", "readAt");
-- CreateIndex
CREATE UNIQUE INDEX "FeedbackForward_feedbackId_toUserId_key" ON "FeedbackForward"("feedbackId", "toUserId");
-- AddForeignKey
ALTER TABLE "FeedbackForward" ADD CONSTRAINT "FeedbackForward_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "FeedbackSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FeedbackForward" ADD CONSTRAINT "FeedbackForward_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FeedbackForward" ADD CONSTRAINT "FeedbackForward_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The issue workflow is replaced by forwarding: remove its permissions (role links cascade).
DELETE FROM "Permission" WHERE "key" IN ('issue.view', 'issue.update');
