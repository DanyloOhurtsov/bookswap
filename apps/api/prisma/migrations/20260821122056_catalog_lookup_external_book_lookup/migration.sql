-- CreateTable
CREATE TABLE "ExternalBookLookup" (
    "isbn" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalBookLookup_pkey" PRIMARY KEY ("isbn")
);
