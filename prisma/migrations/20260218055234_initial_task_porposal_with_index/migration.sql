-- CreateIndex
CREATE INDEX "Task_taskerId_idx" ON "Task"("taskerId");

-- CreateIndex
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");
