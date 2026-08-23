-- CreateTable
CREATE TABLE "FeeDefault" (
    "id" TEXT NOT NULL,
    "feeFlat" DECIMAL(65,30) NOT NULL DEFAULT 100000,
    "feePercent" DECIMAL(65,30) NOT NULL DEFAULT 8,
    "feeBasis" "FeeBasis" NOT NULL DEFAULT 'ACCESSED_AMOUNT',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "FeeDefault_pkey" PRIMARY KEY ("id")
);
