-- РУЧНА ПРАВКА: єдине визначення нормалізації пошукового тексту.
--
-- §4.4 описує `titleNorm` як «lower + unaccent». Ця функція — саме воно, і вона
-- ЄДИНА: нею заповнюються `Work.titleNorm` та `Author.nameNorm` і нею ж
-- нормалізується пошуковий запит. Дві реалізації (одна в SQL, друга в TS)
-- розійшлися б на першому ж українському слові: `lower(unaccent('Їжак'))` дає
-- «їжак», а NFD-нормалізація в JS — «іжак», бо знімає діакритику з `ї`.
--
-- IMMUTABLE тут чесний лише завдяки двоаргументному `unaccent` з явним
-- `regdictionary`: одноаргументний залежить від `search_path`, тому й STABLE, а
-- STABLE-функцію не можна класти в індексний вираз.
CREATE OR REPLACE FUNCTION bookswap_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1))
$$;

-- DropIndex
DROP INDEX "author_name_trgm_idx";

-- AlterTable
-- РУЧНА ПРАВКА: колонка додається як nullable, заповнюється й лише тоді стає
-- NOT NULL. Згенерований `ADD COLUMN ... NOT NULL` без дефолту падає на будь-якій
-- непорожній таблиці — а вона непорожня всюди, де вже є каталог.
ALTER TABLE "Author" ADD COLUMN "nameNorm" TEXT;

UPDATE "Author" SET "nameNorm" = bookswap_norm("name");

ALTER TABLE "Author" ALTER COLUMN "nameNorm" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Author_nameNorm_idx" ON "Author"("nameNorm");

-- CreateIndex
CREATE INDEX "author_name_trgm_idx" ON "Author" USING GIN ("nameNorm" gin_trgm_ops);
