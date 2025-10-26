-- CreateTable
CREATE TABLE "CMPriceGuideQueue" (
    "id" SERIAL NOT NULL,
    "line" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CMPriceGuideQueue_pkey" PRIMARY KEY ("id")
);
