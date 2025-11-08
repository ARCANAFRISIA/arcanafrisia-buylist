-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "lastTs" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_provider_key" ON "SyncCursor"("provider");

-- CreateIndex
CREATE INDEX "CTOrder_paidAt_idx" ON "CTOrder"("paidAt");

-- CreateIndex
CREATE INDEX "CTOrder_sentAt_idx" ON "CTOrder"("sentAt");

-- CreateIndex
CREATE INDEX "CTOrder_creditAddedAt_idx" ON "CTOrder"("creditAddedAt");
