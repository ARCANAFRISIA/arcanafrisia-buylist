-- CreateTable
CREATE TABLE "BlueprintMapping" (
    "blueprintId" INTEGER NOT NULL,
    "expansionId" INTEGER NOT NULL,
    "name" TEXT,
    "collectorNumber" TEXT,
    "cardmarketId" INTEGER,
    "scryfallId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlueprintMapping_pkey" PRIMARY KEY ("blueprintId")
);

-- CreateIndex
CREATE INDEX "BlueprintMapping_expansionId_idx" ON "BlueprintMapping"("expansionId");
