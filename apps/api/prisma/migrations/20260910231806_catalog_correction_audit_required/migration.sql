/*
  Warnings:

  - Made the column `createdById` on table `Translation` required. This step will fail if there are existing NULL values in that column.
  - Made the column `position` on table `WorkAuthor` required. This step will fail if there are existing NULL values in that column.

*/
-- docs/plan/stage-8-inventory.md, §5: другий крок бекфілу
-- (20260910231627_catalog_correction_audit_schema) — окрема, попередня
-- міграція. `SET NOT NULL` тут — і є та «перевірка відсутності NULL»: Postgres
-- сканує всю таблицю й падає з помилкою, якщо бекфіл лишив хоч один рядок без
-- значення, замість мовчки застосуватися.

-- AlterTable
ALTER TABLE "Translation" ALTER COLUMN "createdById" SET NOT NULL;

-- AlterTable
ALTER TABLE "WorkAuthor" ALTER COLUMN "position" SET NOT NULL;
