-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN     "blockedById" TEXT;

-- РУЧНА ПРАВКА. Prisma Schema Language не виражає CHECK-обмежень, тож обидва
-- нижче лишаються поза її знанням — як `one_active_loan_per_copy` у першій
-- міграції. Див. README, розділ про правку міграцій руками.

-- Інваріант §5.3.5. Досі тримався лише кодом (`friendshipPair` у seed.ts і
-- `normalizePair` у сервісі). Тепер його тримає БД: це та перевірка, яку легше
-- за все забути в новому запиті, і найдорожча, коли забув — пара роздвоюється
-- на два рядки, і «чи ми друзі» починає залежати від того, хто питає.
ALTER TABLE "Friendship" ADD CONSTRAINT "friendship_ab_ordered"
  CHECK ("userAId" < "userBId");

-- Контракт нового поля: автор блокування є тоді й лише тоді, коли статус BLOCKED.
-- Єдиний вихід зі стану BLOCKED — видалення рядка (розблокування), тож інваріант
-- не має де зламатися. Якщо колись з'явиться перехід BLOCKED → інший статус, він
-- зобов'язаний занулити `blockedById`, інакше впаде саме тут.
ALTER TABLE "Friendship" ADD CONSTRAINT "friendship_blocked_has_author"
  CHECK (("status" = 'BLOCKED'::"FriendshipStatus") = ("blockedById" IS NOT NULL));
