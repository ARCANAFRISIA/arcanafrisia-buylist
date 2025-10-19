-- CreateTable
CREATE TABLE "CTMarketSummary" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blueprintId" INTEGER NOT NULL,
    "cardmarketId" INTEGER,
    "scryfallId" TEXT,
    "bucket" TEXT NOT NULL,
    "isFoil" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "minPrice" DECIMAL(10,2),
    "medianPrice" DECIMAL(10,2),
    "offerCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CTMarketSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CTMarketSummary_capturedAt_idx" ON "CTMarketSummary"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CTMarketSummary_blueprintId_bucket_isFoil_capturedAt_key" ON "CTMarketSummary"("blueprintId", "bucket", "isFoil", "capturedAt");
