-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectUserId" TEXT,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEvent_dedupeKey_key" ON "ProductEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "ProductEvent_type_occurredAt_idx" ON "ProductEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductEvent_subjectUserId_type_idx" ON "ProductEvent"("subjectUserId", "type");

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
