-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_CANCELLED';

-- РУЧНА ПРАВКА нижче. Prisma Schema Language не виражає CHECK-обмежень, тож
-- інваріанти §5.3, які база здатна тримати сама, дописані сюди руками — так само,
-- як `one_active_loan_per_copy` у першій міграції та два CHECK'и `Friendship`.
--
-- Навіщо дублювати те, що вже тримає `LoanService`: код захищає від помилки в
-- запиті, база — від запиту в обхід коду, тобто від міграції, скрипта чи seed'а,
-- який колись напишуть похапцем.

-- §5.3.4: `Loan.borrowerId ≠ Loan.ownerId`. Позичити в самого себе не можна, і це
-- не лише безглуздо: на такому рядку розсипається §5.3.2, бо передача володіння
-- нікуди не веде.
ALTER TABLE "Loan" ADD CONSTRAINT "loan_borrower_not_owner"
  CHECK ("borrowerId" <> "ownerId");

-- §5.3.2 — ОСЛАБЛЕНИЙ до трьох імплікацій замість еквівалентності.
--
-- Дослівне «AVAILABLE ⟺ currentHolderId = ownerId» суперечить власній таблиці
-- §5.1 і §4.5 одразу двічі:
--   * RESERVED — «APPROVED не змінює currentHolderId», отже книжка вдома, а
--     статус не AVAILABLE;
--   * UNAVAILABLE — «власник тимчасово не дає», книжка теж удома.
-- Обидва рядки порушили б еквівалентність, тож вона не є інваріантом системи.
--
-- Усі три вирази строго TRUE або FALSE: `status`, `currentHolderId` і `ownerId` —
-- NOT NULL, тож NULL-пастка CHECK'а (через яку `friendship_block_author_valid`
-- довелося писати через CASE) тут недосяжна.

-- 1. Вільна книжка завжди вдома.
ALTER TABLE "Copy" ADD CONSTRAINT "copy_available_is_home"
  CHECK ("status" <> 'AVAILABLE'::"CopyStatus" OR "currentHolderId" = "ownerId");

-- 2. Книжка не вдома буває рівно у двох станах: у позичальника (LENT_OUT) або
--    втрачена ним (UNAVAILABLE, §5.1 `HANDED_OVER → LOST` лишає тримача).
--    Наслідок, який варто бачити: RESERVED сюди не входить, тобто «домовлено»
--    автоматично означає «ще вдома» — рівно як вимагає §5.2.
ALTER TABLE "Copy" ADD CONSTRAINT "copy_away_is_lent_or_unavailable"
  CHECK ("currentHolderId" = "ownerId"
         OR "status" IN ('LENT_OUT'::"CopyStatus", 'UNAVAILABLE'::"CopyStatus"));

-- 3. Зворотний бік: LENT_OUT означає, що книжка фізично в іншої людини.
--    Без цього рядка «позичена сама собі» пройшла б.
ALTER TABLE "Copy" ADD CONSTRAINT "copy_lent_out_is_away"
  CHECK ("status" <> 'LENT_OUT'::"CopyStatus" OR "currentHolderId" <> "ownerId");

-- Інваріант §5.3.3 (`LENT_OUT` ⟹ існує рівно один `HANDED_OVER` із
-- `borrowerId = currentHolderId`) свідомо НЕ виражається CHECK'ом: це твердження
-- про дві таблиці одразу, а CHECK бачить лише один рядок. Його тримає
-- `LoanService`, а перевіряють integration-тести на живій PostgreSQL.
