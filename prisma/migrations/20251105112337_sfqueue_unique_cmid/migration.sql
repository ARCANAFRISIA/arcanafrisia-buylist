/*
  Warnings:

  - A unique constraint covering the columns `[cardmarketId]` on the table `ScryfallLookupQueue` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "BlueprintMapping_expansionId_idx";

-- DropIndex
DROP INDEX "BlueprintMapping_setCode_foil_idx";

-- AlterTable
ALTER TABLE "ScryfallLookupQueue" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextTryAt" TIMESTAMP(3),
ADD COLUMN     "notFound" BOOLEAN DEFAULT false,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BlueprintMapping_scryfallId_idx" ON "BlueprintMapping"("scryfallId");

-- CreateIndex
CREATE INDEX "BlueprintMapping_setCode_collectorNumber_idx" ON "BlueprintMapping"("setCode", "collectorNumber");

-- CreateIndex
CREATE INDEX "BlueprintMapping_cardmarketId_idx" ON "BlueprintMapping"("cardmarketId");

-- CreateIndex
CREATE UNIQUE INDEX "ScryfallLookupQueue_cardmarketId_key" ON "ScryfallLookupQueue"("cardmarketId");
