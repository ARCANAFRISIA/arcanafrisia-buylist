-- CreateTable
CREATE TABLE "Product" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "setCode" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'EN',
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "scarcity" TEXT,
    "cmTrend" DECIMAL,
    "cmTrendAt" DATETIME
);

-- CreateTable
CREATE TABLE "PriceGuide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" INTEGER NOT NULL,
    "trend" DECIMAL,
    "trendFoil" DECIMAL,
    "source" TEXT DEFAULT 'Cardmarket',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "subtotalCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubmissionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "productId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "lineCents" INTEGER NOT NULL,
    CONSTRAINT "SubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubmissionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceGuide_productId_key" ON "PriceGuide"("productId");

-- CreateIndex
CREATE INDEX "SubmissionItem_submissionId_idx" ON "SubmissionItem"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionItem_productId_idx" ON "SubmissionItem"("productId");
