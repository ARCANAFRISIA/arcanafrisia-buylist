/*
  Warnings:

  - Made the column `notFound` on table `ScryfallLookupQueue` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "ScryfallLookupQueue_cardmarketId_idx";

-- AlterTable
ALTER TABLE "ScryfallLookupQueue" ALTER COLUMN "notFound" SET NOT NULL;
