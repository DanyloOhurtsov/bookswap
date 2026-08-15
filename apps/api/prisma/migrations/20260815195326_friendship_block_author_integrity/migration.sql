-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- РУЧНА ПРАВКА. Посилення CHECK'а з попередньої міграції.
--
-- Стара умова `(status = 'BLOCKED') = (blockedById IS NOT NULL)` покривала лише
-- дві з трьох вимог: вона стежила за наявністю автора, але не за тим, що автор
-- узагалі належить до пари. Рядок зі `blockedById` стороннього користувача база
-- приймала, а на ньому тримається ПРАВО знімати блок — тобто помилка в записі
-- віддала б чужий блок у чужі руки.
DROP INDEX IF EXISTS "friendship_blocked_has_author";
ALTER TABLE "Friendship" DROP CONSTRAINT IF EXISTS "friendship_blocked_has_author";

-- Умова написана через CASE навмисно, а не як кон'юнкція порівнянь.
--
-- CHECK у PostgreSQL пропускає рядок, коли вираз дає TRUE **або NULL**, і це та
-- пастка, на якій такі перевірки тихо перестають працювати: наївне
-- `blockedById IN ("userAId", "userBId")` для NULL дає NULL, тобто рядок без
-- автора проходить. Тут кожна гілка CASE повертає строго TRUE або FALSE:
--
--   * гілка BLOCKED:  `NULL IS NOT NULL` → FALSE, а `FALSE AND NULL` → FALSE;
--   * гілка ELSE:     `IS NULL` за визначенням не буває NULL;
--   * сам предикат WHEN не буває NULL, бо `status` — NOT NULL.
--
-- Тобто перевірка fail-closed: щоб пройти, рядок мусить бути явно правильним.
ALTER TABLE "Friendship" ADD CONSTRAINT "friendship_block_author_valid"
  CHECK (
    CASE
      WHEN "status" = 'BLOCKED'::"FriendshipStatus"
        THEN "blockedById" IS NOT NULL
             AND ("blockedById" = "userAId" OR "blockedById" = "userBId")
      ELSE "blockedById" IS NULL
    END
  );
