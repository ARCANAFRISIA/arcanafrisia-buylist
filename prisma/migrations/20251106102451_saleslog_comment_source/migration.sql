-- CreateTable
CREATE TABLE "CTOrder" (
    "id" SERIAL NOT NULL,
    "ctOrderId" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "creditAddedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sellerTotalEur" DECIMAL(65,30),
    "sellerSubtotalEur" DECIMAL(65,30),
    "sellerFeeEur" DECIMAL(65,30),
    "shippingEur" DECIMAL(65,30),
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtDb" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CTOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CTOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "blueprintId" INTEGER,
    "cardmarketId" INTEGER,
    "scryfallId" TEXT,
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceEur" DECIMAL(65,30) NOT NULL,
    "lineGrossEur" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3),
    "commentRaw" TEXT,
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtDb" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CTOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLog" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "ctOrderId" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "blueprintId" INTEGER,
    "cardmarketId" INTEGER,
    "scryfallId" TEXT,
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPriceEur" DECIMAL(65,30) NOT NULL,
    "lineTotalEur" DECIMAL(65,30) NOT NULL,
    "shippingEur" DECIMAL(65,30),
    "feeEur" DECIMAL(65,30),
    "comment" TEXT,
    "sourceCode" TEXT,
    "sourceDate" TIMESTAMP(3),
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtDb" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CTOrder_ctOrderId_key" ON "CTOrder"("ctOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLog_source_externalId_key" ON "SalesLog"("source", "externalId");

-- AddForeignKey
ALTER TABLE "CTOrderLine" ADD CONSTRAINT "CTOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CTOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
