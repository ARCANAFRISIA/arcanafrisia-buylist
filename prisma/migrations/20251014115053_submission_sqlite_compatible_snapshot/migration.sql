/*
  Warnings:

  - Added the required column `payoutPct` to the `Submission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serverTotalCents` to the `Submission` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "subtotalCents" INTEGER NOT NULL,
    "serverTotalCents" INTEGER NOT NULL,
    "clientTotalCents" INTEGER,
    "payoutPct" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "pricingSource" TEXT NOT NULL DEFAULT 'Cardmarket',
    "metaText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Submission" ("createdAt", "email", "id", "status", "subtotalCents", "updatedAt") SELECT "createdAt", "email", "id", "status", "subtotalCents", "updatedAt" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE TABLE "new_SubmissionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "productId" BIGINT NOT NULL,
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "qty" INTEGER NOT NULL,
    "trendCents" INTEGER,
    "trendFoilCents" INTEGER,
    "unitCents" INTEGER NOT NULL,
    "lineCents" INTEGER NOT NULL,
    "pct" INTEGER,
    CONSTRAINT "SubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SubmissionItem" ("id", "lineCents", "productId", "qty", "submissionId", "unitCents") SELECT "id", "lineCents", "productId", "qty", "submissionId", "unitCents" FROM "SubmissionItem";
DROP TABLE "SubmissionItem";
ALTER TABLE "new_SubmissionItem" RENAME TO "SubmissionItem";
CREATE INDEX "SubmissionItem_submissionId_idx" ON "SubmissionItem"("submissionId");
CREATE INDEX "SubmissionItem_productId_idx" ON "SubmissionItem"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
