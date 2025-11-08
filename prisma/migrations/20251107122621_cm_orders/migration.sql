/*
  Warnings:

  - You are about to drop the `SyncCursor` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "CTOrder_creditAddedAt_idx";

-- DropIndex
DROP INDEX "CTOrder_paidAt_idx";

-- DropIndex
DROP INDEX "CTOrder_sentAt_idx";

-- DropTable
DROP TABLE "SyncCursor";

-- CreateTable
CREATE TABLE "CMOrder" (
    "id" SERIAL NOT NULL,
    "cmOrderId" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "dateBought" TIMESTAMPTZ(3),
    "datePaid" TIMESTAMPTZ(3),
    "dateSent" TIMESTAMPTZ(3),
    "dateReceived" TIMESTAMPTZ(3),
    "currency" TEXT,
    "totalValueEur" DOUBLE PRECISION,
    "articleCount" INTEGER,
    "buyerUsername" TEXT,
    "sellerUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CMOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CMOrderLine" (
    "id" SERIAL NOT NULL,
    "cmLineId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "cardmarketId" INTEGER,
    "isFoil" BOOLEAN,
    "condition" TEXT,
    "language" TEXT,
    "expansion" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceEur" DOUBLE PRECISION NOT NULL,
    "lineGrossEur" DOUBLE PRECISION NOT NULL,
    "commentRaw" TEXT,
    "createdAt" TIMESTAMPTZ(3),
    "blueprintId" INTEGER,
    "scryfallId" TEXT,

    CONSTRAINT "CMOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CMOrder_cmOrderId_key" ON "CMOrder"("cmOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CMOrderLine_cmLineId_key" ON "CMOrderLine"("cmLineId");

-- CreateIndex
CREATE INDEX "CMOrderLine_orderId_idx" ON "CMOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "CMOrderLine_cardmarketId_idx" ON "CMOrderLine"("cardmarketId");

-- AddForeignKey
ALTER TABLE "CMOrderLine" ADD CONSTRAINT "CMOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CMOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
