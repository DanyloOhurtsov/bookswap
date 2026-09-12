-- CreateEnum
CREATE TYPE "CatalogEntityType" AS ENUM ('WORK', 'TRANSLATION', 'EDITION');

-- AlterTable
ALTER TABLE "Edition" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
-- РУЧНА ПРАВКА: `createdById` додається nullable і бекфілиться нижче — той самий
-- прийом, що й `Author.nameNorm` у 20260816091805_catalog_search_normalization.
-- На відміну від того випадку, `SET NOT NULL` тут навмисно НЕ в цій самій міграції:
-- docs/plan/stage-8-inventory.md, §5 — «наступний migration step робить creator
-- field required» окремим кроком
-- (20260910231628_catalog_correction_audit_required), щоб NULL-перевірку можна
-- було підтвердити між двома деплоями, а не покладатися на те, що бекфіл нижче
-- відпрацював без збоїв у тій самій транзакції.
ALTER TABLE "Translation" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Work" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
-- РУЧНА ПРАВКА: `position` — теж nullable-спочатку, теж бекфілиться нижче,
-- теж стає `NOT NULL` окремою наступною міграцією — з тієї самої причини.
ALTER TABLE "WorkAuthor" ADD COLUMN     "position" INTEGER;

-- РУЧНА ПРАВКА нижче: бекфіл двох нових колонок на наявних рядках.
--
-- Translation.createdById — з батьківського Work.createdById. §5 execution
-- plan прямо вимагає саме цей бекфіл; `Work.createdById` існує для кожного
-- `Translation.workId` (NOT NULL FK), тож після цього UPDATE жоден рядок не
-- лишається без творця.
--
-- Маркери BACKFILL:CREATOR:* нижче — не для Postgres (це звичайний SQL-коментар),
-- а для `test/db/catalog-correction-backfill.db-spec.ts`: він читає файл цієї
-- міграції й виконує РІВНО цей блок текстом, без переписування, щоб довести
-- відповідність тесту й того, що покотиться в прод.
-- BACKFILL:CREATOR:START
UPDATE "Translation" t
SET "createdById" = w."createdById"
FROM "Work" w
WHERE w."id" = t."workId" AND t."createdById" IS NULL;
-- BACKFILL:CREATOR:END

-- WorkAuthor.position — відтворює порядок, який catalog.mapper.ts (`toWorkAuthors`)
-- показував ДО цієї міграції: спершу роль (AUTHOR → CO_AUTHOR → EDITOR →
-- ILLUSTRATOR), далі ім'я автора українською, далі authorId як детермінований
-- останній тай-брейк. docs/plan/stage-8-inventory.md §5/R10a прямо забороняє
-- мовчки підмінити це сортуванням за замовчуванням: `COLLATE "uk-x-icu"` —
-- вбудована ICU-колація PostgreSQL (не розширення, є в pg_collation з коробки),
-- а не `default`/`C`, під якою кирилиця сортується побайтово і "Ґ" не стоїть
-- поруч із "Г". Відповідність цього запиту JS `localeCompare(..., 'uk')` на
-- складних кириличних іменах перевіряє
-- `test/db/catalog-correction-backfill.db-spec.ts` (маркери BACKFILL:POSITION:*).
-- BACKFILL:POSITION:START
WITH ordered AS (
  SELECT
    wa."workId",
    wa."authorId",
    wa."role",
    ROW_NUMBER() OVER (
      PARTITION BY wa."workId"
      ORDER BY
        CASE wa."role"
          WHEN 'AUTHOR' THEN 0
          WHEN 'CO_AUTHOR' THEN 1
          WHEN 'EDITOR' THEN 2
          WHEN 'ILLUSTRATOR' THEN 3
        END,
        a."name" COLLATE "uk-x-icu",
        wa."authorId"
    ) - 1 AS position
  FROM "WorkAuthor" wa
  JOIN "Author" a ON a."id" = wa."authorId"
)
UPDATE "WorkAuthor" wa
SET "position" = ordered."position"
FROM ordered
WHERE wa."workId" = ordered."workId"
  AND wa."authorId" = ordered."authorId"
  AND wa."role" = ordered."role";
-- BACKFILL:POSITION:END

-- CreateTable
CREATE TABLE "CatalogRevision" (
    "id" TEXT NOT NULL,
    "entityType" "CatalogEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "fromRevision" INTEGER NOT NULL,
    "toRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogRevision_entityType_entityId_createdAt_idx" ON "CatalogRevision"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogRevision_actorId_idx" ON "CatalogRevision"("actorId");

-- CreateIndex
CREATE INDEX "Translation_createdById_idx" ON "Translation"("createdById");

-- AddForeignKey
ALTER TABLE "CatalogRevision" ADD CONSTRAINT "CatalogRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
