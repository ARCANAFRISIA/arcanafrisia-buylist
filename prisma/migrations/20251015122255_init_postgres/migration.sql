-- CreateTable
CREATE TABLE "Product" (
    "id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "setCode" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'EN',
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "scarcity" TEXT,
    "cmTrend" DECIMAL(65,30),
    "cmTrendAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceGuide" (
    "id" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "trend" DECIMAL(65,30),
    "trendFoil" DECIMAL(65,30),
    "source" TEXT DEFAULT 'Cardmarket',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "subtotalCents" INTEGER NOT NULL,
    "serverTotalCents" INTEGER NOT NULL,
    "clientTotalCents" INTEGER,
    "payoutPct" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "pricingSource" TEXT NOT NULL DEFAULT 'Cardmarket',
    "metaText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionItem" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "productId" BIGINT NOT NULL,
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "qty" INTEGER NOT NULL,
    "trendCents" INTEGER,
    "trendFoilCents" INTEGER,
    "unitCents" INTEGER NOT NULL,
    "lineCents" INTEGER NOT NULL,
    "pct" INTEGER,

    CONSTRAINT "SubmissionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceGuide_productId_key" ON "PriceGuide"("productId");

-- CreateIndex
CREATE INDEX "SubmissionItem_submissionId_idx" ON "SubmissionItem"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionItem_productId_idx" ON "SubmissionItem"("productId");

-- AddForeignKey
ALTER TABLE "SubmissionItem" ADD CONSTRAINT "SubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
