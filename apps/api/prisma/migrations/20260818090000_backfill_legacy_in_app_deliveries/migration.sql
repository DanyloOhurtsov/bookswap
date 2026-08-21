-- Data migration, не DDL: доповнює доставками Notification-рядки, створені до
-- того, як КОД почав писати NotificationDelivery. Таблиця NotificationDelivery
-- існує в схемі від першої міграції (§14) — не з'явилася лише тепер; це
-- NotificationsService етапу 5 (стейт-машина лоанів, дружба) писав лише
-- Notification, без жодного рядка доставки, бо диспетчера, який ці рядки
-- читає, ще не існувало.
--
-- list/markRead/readAll у NotificationsService фільтрують за наявністю IN_APP
-- delivery (§7.6: IN_APP — повноправна клітинка матриці, і центр сповіщень
-- показує лише події, які справді отримали цю доставку). Без бекфілу історичні
-- сповіщення лишаються назавжди невидимими — не помилка запису, а розрив між
-- старими даними й новою умовою читання.
--
-- Ідемпотентність: WHERE NOT EXISTS виключає Notification, які вже мають
-- IN_APP-доставку (створену звичайним шляхом через NotificationsService після
-- цієї міграції або повторним прогоном самої міграції). Повторний прогін —
-- нуль додаткових рядків.
--
-- Id генерується явно в SQL (`gen_random_uuid()`), а не Prisma-рівневим
-- cuid(): це raw-міграція, вона не проходить крізь клієнт, і покладатися на
-- те, що якийсь застосунковий код колись підставить id, — помилка. Формат не
-- cuid, а uuid, і це навмисно не заважає: `NotificationDelivery.id` — це
-- звичайний текстовий стовпець без перевірки формату ні в базі, ні в коді.
-- `gen_random_uuid()` вбудована в PostgreSQL із версії 13 (без pgcrypto).
--
-- status одразу SENT, а не PENDING: диспетчер існує вже ПІСЛЯ того, як ці
-- Notification були створені, і немає жодного зовнішнього каналу, який має
-- «доставити» IN_APP заднім числом — рядок і так завжди був show-даним у
-- застарілому UI (до фільтра за deliveries). sentAt узгоджується з моментом,
-- коли подія справді виникла (Notification.createdAt), а не з моментом
-- застосування міграції — інакше «коли надіслано» брехало б.
INSERT INTO "NotificationDelivery"
  ("id", "notificationId", "channel", "status", "attempts", "sentAt", "nextAttemptAt", "leaseToken", "leaseUntil", "error")
SELECT
  gen_random_uuid()::text,
  n."id",
  'IN_APP',
  'SENT',
  0,
  n."createdAt",
  n."createdAt",
  NULL,
  NULL,
  NULL
FROM "Notification" n
WHERE NOT EXISTS (
  SELECT 1
  FROM "NotificationDelivery" d
  WHERE d."notificationId" = n."id" AND d."channel" = 'IN_APP'
);
