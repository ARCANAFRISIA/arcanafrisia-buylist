-- CreateTable
CREATE TABLE "CTMarketLatest" (
    "blueprintId" INTEGER NOT NULL,
    "bucket" TEXT NOT NULL,
    "isFoil" BOOLEAN NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "minPrice" DOUBLE PRECISION,
    "medianPrice" DOUBLE PRECISION,
    "offerCount" INTEGER,
    "cardmarketId" INTEGER,
    "scryfallId" TEXT,

    CONSTRAINT "CTMarketLatest_pkey" PRIMARY KEY ("blueprintId","bucket","isFoil")
);

-- CreateTable
CREATE TABLE "ScryfallCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "set" TEXT NOT NULL,
    "collectorNumber" TEXT NOT NULL,
    "finishes" TEXT[],
    "imageSmall" TEXT,
    "imageNormal" TEXT,
    "releasedAt" TIMESTAMP(6),
    "cardmarketId" INTEGER,

    CONSTRAINT "ScryfallCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CMPriceGuide" (
    "cardmarketId" INTEGER NOT NULL,
    "trend" DOUBLE PRECISION,
    "foilTrend" DOUBLE PRECISION,
    "lowEx" DOUBLE PRECISION,
    "suggested" DOUBLE PRECISION,
    "germanProLow" DOUBLE PRECISION,
    "avg1" DOUBLE PRECISION,
    "avg7" DOUBLE PRECISION,
    "avg30" DOUBLE PRECISION,
    "foilAvg1" DOUBLE PRECISION,
    "foilAvg7" DOUBLE PRECISION,
    "foilAvg30" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CMPriceGuide_pkey" PRIMARY KEY ("cardmarketId")
);

-- CreateIndex
CREATE INDEX "ScryfallCard_name_set_collectorNumber_idx" ON "ScryfallCard"("name", "set", "collectorNumber");

-- CreateIndex
CREATE INDEX "idx_ctsummary_key_captured" ON "CTMarketSummary"("blueprintId", "isFoil", "bucket", "capturedAt");

-- RenameIndex
ALTER INDEX "CTMarketSummary_capturedAt_idx" RENAME TO "idx_ctsummary_captured";
