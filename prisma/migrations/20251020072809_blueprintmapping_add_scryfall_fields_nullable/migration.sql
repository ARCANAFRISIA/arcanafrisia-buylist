-- AlterTable
ALTER TABLE "BlueprintMapping" ADD COLUMN     "foil" BOOLEAN,
ADD COLUMN     "setCode" TEXT;

-- CreateIndex
CREATE INDEX "BlueprintMapping_setCode_foil_idx" ON "BlueprintMapping"("setCode", "foil");
