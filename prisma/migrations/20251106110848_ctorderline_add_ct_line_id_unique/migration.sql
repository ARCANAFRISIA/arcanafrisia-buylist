/*
  Warnings:

  - A unique constraint covering the columns `[ctLineId]` on the table `CTOrderLine` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ctLineId` to the `CTOrderLine` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CTOrderLine" ADD COLUMN     "ctLineId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CTOrderLine_ctLineId_key" ON "CTOrderLine"("ctLineId");
