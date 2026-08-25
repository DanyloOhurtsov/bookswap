-- DropIndex
DROP INDEX "Review_workId_userId_key";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMergeSourceId" TEXT;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_archivedByMergeSourceId_fkey" FOREIGN KEY ("archivedByMergeSourceId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- РУЧНА ПРАВКА нижче. Prisma Schema Language не виражає ЧАСТКОВИХ унікальних
-- індексів, тож правило §4.7 «один користувач — один відгук на твір» дописане
-- сюди руками — так само, як `one_active_loan_per_copy` у першій міграції.
--
-- Навіщо взагалі частковий: мерж двох `Work` (§6.3, R5 у docs/plan/stage-7.md)
-- переносить рецензії на канонічний твір, і якщо людина встигла оцінити обидва
-- дублікати, після переносу в неї виходить дві рецензії на один твір. Суцільний
-- unique лишав би рівно два виходи — впасти або видалити чужий текст. Обидва
-- неприйнятні, тому програшна рецензія отримує `archivedAt` і випадає з-під
-- обмеження, не зникаючи з бази.
--
-- `DROP INDEX` вище прибирає саме суцільний варіант (`Review_workId_userId_key`):
-- разом вони не мають сенсу — суцільний забороняв би те, заради чого заводиться
-- частковий.
CREATE UNIQUE INDEX one_active_review_per_work_user
  ON "Review" ("workId", "userId")
  WHERE "archivedAt" IS NULL;
