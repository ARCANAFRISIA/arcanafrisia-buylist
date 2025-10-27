-- CreateTable
CREATE TABLE "ScryfallLookup" (
    "cardmarketId" INTEGER NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "oracleId" TEXT,
    "name" TEXT NOT NULL,
    "set" TEXT NOT NULL,
    "collectorNumber" TEXT,
    "lang" TEXT,
    "imageSmall" TEXT,
    "imageNormal" TEXT,
    "rarity" TEXT,
    "usd" DOUBLE PRECISION,
    "eur" DOUBLE PRECISION,
    "tix" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScryfallLookup_pkey" PRIMARY KEY ("cardmarketId")
);

-- CreateTable
CREATE TABLE "ScryfallLookupQueue" (
    "id" SERIAL NOT NULL,
    "cardmarketId" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScryfallLookupQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScryfallLookupQueue_cardmarketId_idx" ON "ScryfallLookupQueue"("cardmarketId");
