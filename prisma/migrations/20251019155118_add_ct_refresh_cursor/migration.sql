-- CreateTable
CREATE TABLE "CTRefreshCursor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "pageSize" INTEGER NOT NULL DEFAULT 250,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CTRefreshCursor_pkey" PRIMARY KEY ("id")
);
