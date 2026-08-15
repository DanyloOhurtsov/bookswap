# Технічне завдання: сервіс обміну фізичними книжками

**Версія:** 2.0
**Замінює:** 1.0
**Розробник:** один інженер (full-stack)

**Що змінилося проти 1.0:** сповіщення виросли з підпункту в повноцінний розділ (§7) з email- і Telegram-каналами; додано моделі `Notification` / `NotificationDelivery`; зафіксовано стек із реальними версіями (§2); додано розділи про локальне середовище (§12) та інфраструктуру Hetzner (§13); перебудовано етапи (§14).

---

## 1. Мета й межі продукту

Веб-сервіс, у якому користувач веде каталог **фізичних** книжок, що є в нього вдома, бачить бібліотеки своїх друзів і може позичити в них книгу через запит із підтвердженням власника.

Сервіс відповідає на три питання:

1. Що є в моїх друзів із того, що я хочу прочитати?
2. Де зараз фізично моя книга і в кого вона була раніше?
3. Якщо той самий твір існує в кількох перекладах — який брати?

**Явно поза межами:** продаж, доставка, обмін назавжди, публічний майданчик незнайомців, електронні книги, мобільні застосунки.

**Масштаб, під який проєктуємо:** десятки–сотні користувачів, кола друзів по 5–50 осіб. Це не highload; головні ризики — не навантаження, а якість даних, консистентність станів і доставка сповіщень.

---

## 2. Стек

Версії зафіксовані станом на початок розробки. Відхилення від них — свідоме рішення, не випадковість.

| Шар | Технологія | Версія |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Пакетний менеджер | pnpm | 11.21 |
| Монорепо | pnpm workspaces + Turborepo | 2.10 |
| Мова | TypeScript | **6.x** (не 7 — див. нижче) |
| Frontend | Next.js (App Router) | 16.3 |
| Backend | NestJS | 11.x |
| ORM | Prisma | 7.x |
| БД | PostgreSQL | 17 (`pg_trgm`, `unaccent`) |
| Reverse proxy | Caddy | 2.x |
| Email | Resend або Postmark | — |
| Хостинг | Hetzner Cloud CAX21 (ARM), Falkenstein | — |

**TypeScript 6, не 7.** TypeScript 7 — нативний порт на Go. Він коректно емітить `design:paramtypes`, тож DI Nest не ламається, але **не має програмного compiler API**, а `nest build` імпортує `typescript` і викликає `createProgram()` зі своїми трансформерами. Наслідок: на сімці не працюють `nest build`, плагіни Swagger і GraphQL, `ts-jest`, `ts-loader` і type-aware правила ESLint. Сімку можна тримати окремо для швидкої перевірки типів у CI (через `npx -p`, щоб вона не потрапила в `node_modules`), але не як компілятор.

**Redis не входить у стек v1.** Кешувати нічого — агрегати денормалізовані в БД, а черга сповіщень реалізується таблицею (див. §7.5). Redis з'явиться тоді, коли з'явиться навантаження, яке його виправдовує.

---

## 3. Глосарій сутностей

Найважливіший розділ документа. Плутанина між цими чотирма поняттями — основне джерело помилок у цьому домені.

| Термін | Означає | Приклад |
|---|---|---|
| **Work** (твір) | Абстрактний твір незалежно від мови й видання | «Шантарам» Ґреґорі Робертса |
| **Translation** (переклад) | Конкретний переклад твору конкретною людиною на конкретну мову | Переклад українською, перекладач такий-то, 2017 |
| **Edition** (видання) | Фізичне видання: видавництво, рік, ISBN. Посилається на `Work` і опційно на `Translation` | КСД, 2019, ISBN 978-617-… |
| **Copy** (примірник) | Одна фізична книжка на полиці конкретного користувача | Потертий примірник із кавовою плямою |

Ключові наслідки:

- **Відгуки й оцінки твору** висять на `Work` — щоб не розповзалися по виданнях.
- **Оцінки якості перекладу** висять на `Translation`, а **не** на `Edition`. Один переклад може виходити в кількох видавництвах і роках; якби оцінка була на виданні, ранг розмазався б по перевиданнях і ніколи не зібрався.
- **Позичається завжди `Copy`**, ніколи не `Work` і не `Edition`.
- **Кількість примірників** — це `COUNT` рядків `Copy`, а не поле `quantity`. Поле ламається щойно один примірник позичений, а другий удома: у них різні стани, різні лоани, різна історія.

---

## 4. Модель даних

### 4.1 Генератор Prisma

Prisma 7 змінила конфігурацію генератора порівняно з 6.x — зокрема вимоги до `output`. **Перевір, що саме згенерував `prisma init`, і адаптуй блок нижче під фактичний синтаксис версії**, не копіюй наосліп:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_DATABASE_URL")
  extensions = [pg_trgm, unaccent]
}
```

`binaryTargets` з `linux-arm64` обов'язковий: цільовий сервер — ARM (Hetzner CAX). Пропуск проявиться лише в рантаймі на сервері помилкою про відсутній query engine.

`directUrl` обов'язковий, навіть якщо локально дублює `url`: у проді `url` піде через PgBouncer, а міграції беруть advisory lock, який не переживає transaction pooling.

### 4.2 Користувачі

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  emailVerified Boolean @default(false)
  passwordHash String
  displayName  String
  avatarUrl    String?
  bio          String?
  createdAt    DateTime @default(now())

  // Видимість
  libraryVisibility Visibility @default(FRIENDS)
  showHolderNames   Boolean    @default(true)

  // Канали сповіщень
  telegramChatId String? @unique

  copiesOwned        Copy[]              @relation("CopyOwner")
  copiesHeld         Copy[]              @relation("CopyHolder")
  loansAsBorrower    Loan[]              @relation("LoanBorrower")
  loansAsOwner       Loan[]              @relation("LoanOwner")
  reviews            Review[]
  translationRatings TranslationRating[]
  friendshipsA       Friendship[]        @relation("FriendA")
  friendshipsB       Friendship[]        @relation("FriendB")
  wishlist           WishlistItem[]
  notifications      Notification[]
  notificationPrefs  NotificationPreference[]

  @@index([displayName])
}

enum Visibility {
  PUBLIC
  FRIENDS
  PRIVATE
}
```

### 4.3 Дружба

Один рядок на пару. Інваріант: `userAId < userBId` лексикографічно — це прибирає `OR`-умови з кожної перевірки «чи ми друзі».

```prisma
model Friendship {
  id            String           @id @default(cuid())
  userAId       String
  userBId       String
  status        FriendshipStatus @default(PENDING)
  requestedById String
  createdAt     DateTime         @default(now())
  respondedAt   DateTime?

  userA User @relation("FriendA", fields: [userAId], references: [id], onDelete: Cascade)
  userB User @relation("FriendB", fields: [userBId], references: [id], onDelete: Cascade)

  @@unique([userAId, userBId])
  @@index([userBId, status])
}

enum FriendshipStatus {
  PENDING
  ACCEPTED
  DECLINED
  BLOCKED
}
```

`requestedById` не виводиться з A/B — порядок визначається сортуванням id, а не тим, хто ініціював.

### 4.4 Каталог

```prisma
model Author {
  id        String @id @default(cuid())
  name      String
  nameLatin String?
  works     WorkAuthor[]

  @@index([name])
}

model WorkAuthor {
  workId   String
  authorId String
  role     AuthorRole @default(AUTHOR)

  work   Work   @relation(fields: [workId], references: [id], onDelete: Cascade)
  author Author @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@id([workId, authorId, role])
}

enum AuthorRole {
  AUTHOR
  CO_AUTHOR
  EDITOR
  ILLUSTRATOR
}

model Work {
  id           String   @id @default(cuid())
  title        String
  titleNorm    String   // lower + unaccent, для пошуку
  origLang     String   // ISO 639-1
  firstPubYear Int?
  description  String?
  createdById  String
  createdAt    DateTime @default(now())

  mergedIntoId String?
  mergedInto   Work?  @relation("WorkMerge", fields: [mergedIntoId], references: [id])
  mergedFrom   Work[] @relation("WorkMerge")

  authors      WorkAuthor[]
  editions     Edition[]
  translations Translation[]
  reviews      Review[]
  wishlistedBy WishlistItem[]

  ratingAvg   Float @default(0)
  ratingCount Int   @default(0)

  @@index([titleNorm])
  @@index([mergedIntoId])
}

model Translation {
  id         String  @id @default(cuid())
  workId     String
  translator String
  lang       String
  sourceLang String  // з якої мови перекладали
  year       Int?

  isAbridged Boolean @default(false)
  hasNotes   Boolean @default(false)
  notes      String?

  work     Work                @relation(fields: [workId], references: [id], onDelete: Cascade)
  editions Edition[]
  ratings  TranslationRating[]

  score       Float @default(0)  // байєсівський ранг, §10
  ratingAvg   Float @default(0)
  ratingCount Int   @default(0)

  @@index([workId, lang])
}

model Edition {
  id            String        @id @default(cuid())
  workId        String
  translationId String?       // null = мовою оригіналу
  publisher     String?
  year          Int?
  isbn13        String?       @unique
  pageCount     Int?
  coverUrl      String?
  format        EditionFormat @default(PAPERBACK)
  createdById   String
  createdAt     DateTime      @default(now())

  work        Work         @relation(fields: [workId], references: [id], onDelete: Cascade)
  translation Translation? @relation(fields: [translationId], references: [id])
  copies      Copy[]

  @@index([workId])
  @@index([translationId])
}

enum EditionFormat {
  HARDCOVER
  PAPERBACK
  POCKET
}
```

### 4.5 Примірники

```prisma
model Copy {
  id        String @id @default(cuid())
  editionId String
  ownerId   String

  // Хто фізично тримає книгу зараз. Дорівнює ownerId, коли книга вдома.
  currentHolderId String

  status     CopyStatus @default(AVAILABLE)
  visibility Visibility @default(FRIENDS)  // ортогонально до status
  condition  Condition  @default(GOOD)
  note       String?
  acquiredAt DateTime?
  createdAt  DateTime   @default(now())

  edition       Edition @relation(fields: [editionId], references: [id])
  owner         User    @relation("CopyOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  currentHolder User    @relation("CopyHolder", fields: [currentHolderId], references: [id])
  loans         Loan[]

  @@index([ownerId, status])
  @@index([currentHolderId])
  @@index([editionId])
}

enum CopyStatus {
  AVAILABLE    // вдома, вільна
  RESERVED     // запит підтверджено, з рук у руки ще не передано
  LENT_OUT     // фізично в позичальника
  UNAVAILABLE  // власник тимчасово не дає
}

enum Condition {
  NEW
  GOOD
  WORN
  DAMAGED
}
```

`status` і `visibility` — **різні осі**. Прихована книга може бути одночасно позиченою; злиття їх в один enum ламається на першому ж такому випадку.

### 4.6 Позичання

Ця таблиця одночасно є історією. Окремої `CopyHistory` немає.

```prisma
model Loan {
  id         String     @id @default(cuid())
  copyId     String
  ownerId    String     // денормалізовано з Copy на момент створення
  borrowerId String
  status     LoanStatus @default(REQUESTED)

  message      String?
  responseNote String?

  requestedAt DateTime  @default(now())
  respondedAt DateTime?
  handedAt    DateTime?
  dueAt       DateTime?
  returnedAt  DateTime?

  copy     Copy @relation(fields: [copyId], references: [id], onDelete: Cascade)
  owner    User @relation("LoanOwner", fields: [ownerId], references: [id])
  borrower User @relation("LoanBorrower", fields: [borrowerId], references: [id])

  @@index([copyId, status])
  @@index([borrowerId, status])
  @@index([ownerId, status])
}

enum LoanStatus {
  REQUESTED
  APPROVED
  REJECTED
  CANCELLED
  HANDED_OVER
  RETURNED
  LOST
}
```

### 4.7 Оцінки

```prisma
model Review {
  id        String   @id @default(cuid())
  workId    String
  userId    String
  rating    Int      // 1..5
  text      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  work Work @relation(fields: [workId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workId, userId])
  @@index([workId])
}

model TranslationRating {
  id            String   @id @default(cuid())
  translationId String
  userId        String
  rating        Int      // 1..5 — якість перекладу, не твору
  text          String?
  createdAt     DateTime @default(now())

  translation Translation @relation(fields: [translationId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([translationId, userId])
}

model WishlistItem {
  id        String   @id @default(cuid())
  userId    String
  workId    String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  work Work @relation(fields: [workId], references: [id], onDelete: Cascade)

  @@unique([userId, workId])
}
```

### 4.8 Сповіщення

```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  payload   Json             // loanId, copyId, actorId тощо
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user       User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  deliveries NotificationDelivery[]

  @@index([userId, readAt])
}

model NotificationDelivery {
  id             String         @id @default(cuid())
  notificationId String
  channel        Channel
  status         DeliveryStatus @default(PENDING)
  attempts       Int            @default(0)
  nextAttemptAt  DateTime       @default(now())
  sentAt         DateTime?
  error          String?

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
}

model NotificationPreference {
  userId  String
  type    NotificationType
  channel Channel
  enabled Boolean @default(true)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, type, channel])
}

model TelegramLinkToken {
  token     String   @id
  userId    String
  expiresAt DateTime
  usedAt    DateTime?

  @@index([userId])
}

enum NotificationType {
  LOAN_REQUESTED
  LOAN_APPROVED
  LOAN_REJECTED
  LOAN_HANDED_OVER
  LOAN_RETURNED
  LOAN_DUE_SOON
  LOAN_OVERDUE
  FRIEND_REQUESTED
  FRIEND_ACCEPTED
}

enum Channel {
  IN_APP
  EMAIL
  TELEGRAM
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED
}
```

**Розділення `Notification` і `NotificationDelivery` не декоративне:** одна подія йде в кілька каналів, і кожен має власний статус та лічильник спроб. У злитій таблиці невдала відправка в Telegram позначила б сповіщення як провалене, хоча email дійшов.

### 4.9 Міграції поза Prisma

Prisma не створює GIN-індекси для `pg_trgm` — додати сирим SQL у **першу** міграцію, згенеровану через `prisma migrate dev --create-only`:

```sql
-- на початок файлу
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- у кінець файлу
CREATE INDEX work_title_trgm_idx ON "Work" USING GIN ("titleNorm" gin_trgm_ops);
CREATE INDEX author_name_trgm_idx ON "Author" USING GIN ("name" gin_trgm_ops);
```

Порядок критичний. Якщо додати індекси окремою пізнішою міграцією, на **чистій** базі вона виконається до `CREATE EXTENSION` і впаде. Локально цього не видно, бо база вже стара й розширення в ній є — помилка проявиться при першому розгортанні на сервері.

---

## 5. Стейт-машина позичання

Найкритичніша частина логіки. Усі переходи — **тільки** через один сервісний метод; прямі апдейти `Loan.status` заборонені, бо кожен перехід тягне зміну `Copy` і створення сповіщення.

```
                    ┌─────────────┐
                    │  REQUESTED  │◄── позичальник створює запит
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐   ┌───────────┐   ┌───────────┐
     │ APPROVED │   │ REJECTED  │   │ CANCELLED │
     └────┬─────┘   └───────────┘   └───────────┘
          │  ▲ власник           термінальні
          │  └── (авто-відхилення конкурентів)
          ▼
   ┌──────────────┐
   │ HANDED_OVER  │◄── позичальник підтверджує отримання
   └──────┬───────┘
          ├──────────────┐
          ▼              ▼
   ┌────────────┐   ┌────────┐
   │  RETURNED  │   │  LOST  │
   └────────────┘   └────────┘
```

### 5.1 Таблиця переходів

| Перехід | Хто | Передумови | Побічні ефекти (в одній транзакції) |
|---|---|---|---|
| `— → REQUESTED` | позичальник | дружба `ACCEPTED`; `Copy.status = AVAILABLE`; примірник видимий; немає власного активного запиту; не власник | створення `Loan`; `Notification(LOAN_REQUESTED)` власнику |
| `REQUESTED → APPROVED` | власник | лоан у `REQUESTED` | `Copy.status = RESERVED`; **усі інші `REQUESTED` на цей примірник → `REJECTED`**; сповіщення апрувленому й відхиленим |
| `REQUESTED → REJECTED` | власник | — | `Notification(LOAN_REJECTED)` |
| `REQUESTED → CANCELLED` | позичальник | — | — |
| `APPROVED → CANCELLED` | позичальник або власник | — | `Copy.status = AVAILABLE`; сповіщення другій стороні |
| `APPROVED → HANDED_OVER` | позичальник | — | `Copy.status = LENT_OUT`; `Copy.currentHolderId = borrowerId`; `handedAt = now()`; сповіщення власнику |
| `HANDED_OVER → RETURNED` | власник | — | `Copy.status = AVAILABLE`; `Copy.currentHolderId = ownerId`; `returnedAt = now()`; сповіщення позичальнику |
| `HANDED_OVER → LOST` | власник | — | `Copy.status = UNAVAILABLE`; `currentHolderId` лишається на позичальнику |

### 5.2 Правила, які легко пропустити

- **Підтвердження ≠ передача.** `APPROVED` означає лише домовленість. Поки позичальник не натиснув «отримав», книга формально вдома. Без цього кроку статуси розсинхронізуються з реальністю в перший же тиждень.
- **Конкурентні запити.** Дозволяємо кільком людям одночасно мати `REQUESTED` на один примірник. Апрув — це `SELECT … FOR UPDATE` на рядку `Copy` всередині транзакції, яка одночасно апрувить один лоан і відхиляє решту. Без блокування власник апрувне два запити з двох вкладок.
- **`OVERDUE` — не статус.** Прострочення виводиться: `status = HANDED_OVER AND dueAt < now()`. Окремий статус довелося б проставляти по крону, і він завжди відставатиме. Сповіщення `LOAN_OVERDUE` при цьому існує — воно генерується щоденною задачею, але статус лоану не змінює.
- **Ланцюгове позичання заборонене.** Створити `Loan` може лише `Copy.owner`. Позичальник не має права передати книгу далі, не повернувши. Інакше стейт-машина розгалужується, а власник втрачає контроль над своєю річчю.
- **Видалення примірника** заблоковане, поки є лоан у статусі `APPROVED` або `HANDED_OVER`.
- **Видалення з друзів не скасовує активні лоани** — фізична книга все одно в когось.

### 5.3 Інваріанти

1. На один `Copy` не більше одного лоану в статусі `APPROVED` або `HANDED_OVER`.
2. `Copy.status = AVAILABLE` ⟺ `currentHolderId = ownerId`.
3. `Copy.status = LENT_OUT` ⟹ існує рівно один `Loan` зі статусом `HANDED_OVER` і `borrowerId = currentHolderId`.
4. `Loan.borrowerId ≠ Loan.ownerId`.
5. `Friendship.userAId < Friendship.userBId`.

Інваріант 1 виноситься в частковий унікальний індекс, щоб БД захищала його сама:

```sql
CREATE UNIQUE INDEX one_active_loan_per_copy
  ON "Loan" ("copyId")
  WHERE status IN ('APPROVED', 'HANDED_OVER');
```

---

## 6. Функціональні вимоги

### 6.1 Акаунт і профіль

- Реєстрація за email + пароль, підтвердження пошти.
- **Auth: session cookie** з `httpOnly` + `SameSite=Lax`. Фронт і бек за одним доменом через Caddy, тому кросдоменних складнощів немає. JWT — лише якщо з'явиться мобільний клієнт.
- Профіль: ім'я, аватар, коротке біо, дефолтна видимість бібліотеки, підключення Telegram, налаштування сповіщень.
- Пошук користувачів за ім'ям; за email — тільки точний збіг.

### 6.2 Дружба

- Надіслати запит, прийняти, відхилити, видалити з друзів, заблокувати.
- Заблокований не бачить бібліотеку й не може надсилати запити.

### 6.3 Каталог

Джерело правди — власна база. Зовнішнє API (Open Library / Google Books) — **лише автозаповнення форми**: користувач вводить ISBN, підтягуються назва, автор, рік, обкладинка, далі редагує руками й дописує перекладача. Зовнішній ID не зберігається як залежність.

Причина власного каталогу: українські видання й перекладачі покриті зовнішніми базами погано, а без перекладачів не працює §10. Дані все одно доведеться вводити руками.

**Флоу додавання книги — найважливіший UX сервісу:**

1. Користувач вводить назву або ISBN.
2. Система шукає збіги у власній базі: `similarity(titleNorm, $1) > 0.3`, показує «Можливо, це одна з цих?» зі списком творів та їхніх видань.
3. Знайшов своє видання → створюється лише `Copy`, кінець.
4. Є твір, немає видання → форма `Edition` з передзаповненим `Work`.
5. Нічого немає → послідовно `Work` → (опційно) `Translation` → `Edition` → `Copy`.

Крок 2 прибирає більшість дублікатів до їхньої появи. Без нього база деградує за тиждень.

**Мердж дублікатів.** Операція «об'єднати два `Work`» (у v1 — адмінський скрипт): переносить `Edition`, `Translation`, `Review`, `WishlistItem` на канонічний запис і проставляє `mergedIntoId` на старому. Старий **не видаляється** — інакше вмирають зовнішні посилання. Читання за id зі встановленим `mergedIntoId` віддає 301 на канонічний.

**Права на редагування метаданих.** Створює будь-хто; редагує автор запису та адмін. Вікі-модель із версіями — свідомо поза межами.

### 6.4 Особиста бібліотека

- Додати / редагувати / видалити примірник (стан, нотатка, видимість).
- Кілька примірників одного видання = кілька рядків `Copy`. У списку групуються: «Шантарам ×3 · 2 вдома, 1 у Марка».
- Фільтри: доступність, мова, автор.
- В'ю «Мої книжки не вдома» — `currentHolderId ≠ ownerId`.
- В'ю «Чужі книжки в мене» — `currentHolderId = me AND ownerId ≠ me`.

### 6.5 Бібліотека друга

- Список примірників з урахуванням `visibility` кожного.
- Позначка, які з них у вішлисті користувача.
- Кнопка «Попросити» — лише для `AVAILABLE`.
- Для `RESERVED` / `LENT_OUT` — орієнтовна дата повернення, якщо власник її вказав.

### 6.6 Історія

Виводиться з `Loan`, окремих таблиць немає.

- **Історія примірника:** усі лоани конкретного `Copy` в хронології.
- **Історія твору:** усі лоани по всіх примірниках цього `Work` серед друзів — «хто з моїх це взагалі читав». Практично корисніше за перше: саме це людина хоче знати перед тим, як просити.
- **Моя історія:** що я брав і що в мене брали.

**Приватність.** Повну історію з іменами бачить власник завжди. Інші — відповідно до `User.showHolderNames`: якщо вимкнено, показується статус без імен («у когось до 12 червня»).

### 6.7 Відгуки й оцінки

Три незалежні осі — не змішувати в одну цифру:

| Що оцінюємо | Модель | Питання |
|---|---|---|
| Твір | `Review` на `Work` | Чи хороша книга? |
| Переклад | `TranslationRating` | Чи добре передано? |
| Видання | *поза v1* | Папір, шрифт, палітурка |

**Право на відгук.** Оцінити `Work` можна, якщо користувач володіє примірником будь-якого його видання або має завершений (`RETURNED`) лоан на такий примірник. Це навмисне обмеження: воно робить оцінку сигналом «чи варто просити цю книгу в друга», а не ще одним загальним рейтингом. Для `Translation` — ті самі умови, але примірник має належати саме до цього перекладу.

Один користувач — один відгук на твір, з можливістю редагувати.

---

## 7. Сповіщення

### 7.1 Чому це не другорядна фіча

Без пуш-каналу стейт-машина §5 не рухається. Запит висить, поки власник випадково не зайде на сайт; три дні тиші — і людина пише в месенджер, обійшовши сервіс. Сповіщення тут не зручність, а механізм, що робить продукт робочим.

### 7.2 Канали

| | Email | Telegram-бот | Web Push |
|---|---|---|---|
| Налаштування користувачем | нуль | одне натискання | дозвіл у браузері |
| Швидкість реакції | години | хвилини | хвилини |
| Дія просто з повідомлення | ні | **так, інлайн-кнопки** | ні |
| iOS | працює | працює | лише як встановлений PWA |

**Рішення:** email — базовий канал, увімкнений завжди; Telegram — опційний, підключається користувачем.

Email береться не тому, що він хороший, а тому, що інфраструктура відправки потрібна незалежно — для підтвердження пошти й скидання пароля. Тобто відправка пишеться один раз і використовується для всього.

Telegram стане основним каналом на практиці: інлайн-кнопки дозволяють власнику погодити запит **прямо з повідомлення**, не відкриваючи сайт. Ланцюг «відкрити сайт → залогінитись → знайти запит → натиснути» — це рівно те тертя, через яке запити висять непоміченими.

Web Push не входить у скоуп: більше тертя при налаштуванні, а на iOS працює лише після встановлення PWA.

**Спільна Telegram-група — відкинуто.** Усі бачать, хто в кого що просить (суперечить §6.6); немає адресації конкретній людині; немає способу довести, що `@username` у групі — власник акаунта. Потрібні приватні чати 1:1 через бота.

### 7.3 Архітектура

Канал не має знати про лоани. Виклик відправки з сервісу лоанів означав би, що додавання третього каналу — це правки в стейт-машині.

```
LoanService.approve()
   └─ транзакція: зміна Loan.status + Copy + запис Notification
                  + NotificationDelivery(PENDING) на кожен увімкнений канал
   └─ після коміту: подія
        ↓
   NotificationDispatcher
        ├─ InAppChannel
        ├─ EmailChannel
        └─ TelegramChannel
```

**Два правила:**

1. **Запис сповіщення — у тій самій транзакції, що й перехід статусу.** Відправка — після коміту. Інакше падіння SMTP відкотить апрув, і власник побачить, що його дія не спрацювала, хоча мала.
2. **Доставка асинхронна, з ретраями.** Воркер раз на 30 секунд забирає `NotificationDelivery` зі `status = PENDING AND nextAttemptAt <= now()`, надсилає, при помилці інкрементує `attempts` і відсуває `nextAttemptAt` з експоненційною затримкою. Після 5 спроб — `FAILED`.

Черга на Redis/BullMQ тут не потрібна: таблиця робить те саме й не додає інфраструктури.

### 7.4 Прив'язка Telegram

1. У профілі кнопка «Підключити Telegram» → бек генерує `TelegramLinkToken` із TTL 10 хвилин.
2. Кнопка веде на `t.me/<BotName>?start=<token>`.
3. Користувач тисне Start; бот отримує `/start <token>` разом із `chat_id`.
4. Бек знаходить токен, зберігає `chat_id` у `User.telegramChatId`, проставляє `usedAt`.

Введення username руками не використовується: незручно і не доводить володіння акаунтом.

**Інлайн-кнопки та безпека.** У повідомленні про запит — кнопки з `callback_data` виду `loan:approve:<loanId>`. Обробник **зобов'язаний** перевірити, що `chat_id`, з якого прийшов колбек, належить власнику саме цього примірника. `callback_data` приходить від клієнта; довіряти їй не можна, інакше будь-хто, хто вгадає `loanId`, апрувить чужий запит.

Дія з кнопки проходить через **той самий** сервісний метод, що й дія з вебу — жодної паралельної реалізації переходів.

### 7.5 Негайно vs дайджест

**Негайно:** `LOAN_REQUESTED`, `LOAN_APPROVED`, `LOAN_REJECTED`, `LOAN_HANDED_OVER`, `LOAN_RETURNED`, `FRIEND_REQUESTED`, `FRIEND_ACCEPTED`.

**Щоденним дайджестом:** `LOAN_DUE_SOON` (за 3 дні до `dueAt`), `LOAN_OVERDUE`, новини бібліотек друзів.

Другу групу не можна дозволяти надсилати негайно: активний користувач перетворить бота на спам, і його вимкнуть разом із важливими сповіщеннями.

### 7.6 Налаштування користувача

Матриця «тип події × канал» у `NotificationPreference`. Дефолти: усе в `IN_APP`, критичне для флоу — в `EMAIL`, після підключення Telegram — усе в `TELEGRAM` з можливістю вимкнути email.

---

## 8. API

REST, `/api/v1`, JSON. Помилки з машиночитним `code`.

### Дружба
```
GET    /friends
GET    /friends/requests
POST   /friends/requests               { userId }
PATCH  /friends/requests/:id           { action: accept | decline }
DELETE /friends/:userId
POST   /friends/:userId/block
```

### Каталог
```
GET    /catalog/search?q=…             fuzzy-пошук по Work + Author
GET    /catalog/lookup?isbn=…          автозаповнення із зовнішнього API
GET    /works/:id
POST   /works
POST   /works/:id/translations
POST   /works/:id/editions
GET    /works/:id/translations         впорядковані за score, з ознаками
GET    /editions/:id
```

### Бібліотека
```
GET    /me/library                     ?status=&lang=&q=
POST   /me/library                     { editionId, condition, note, visibility }
PATCH  /me/library/:copyId
DELETE /me/library/:copyId
GET    /me/library/out
GET    /me/library/borrowed
GET    /users/:id/library
```

### Позичання
```
POST   /loans                          { copyId, message, proposedDueAt }
GET    /loans?role=owner|borrower&status=…
GET    /loans/:id
PATCH  /loans/:id                      { action: approve | reject | cancel |
                                                 hand_over | return | mark_lost,
                                          note?, dueAt? }
```

Один `PATCH` із полем `action` замість окремих ендпоінтів — усі переходи проходять крізь одну точку, де живе валідація стейт-машини.

### Історія
```
GET    /copies/:id/history
GET    /works/:id/history
GET    /me/history
```

### Оцінки
```
POST   /works/:id/reviews              { rating, text }
PATCH  /reviews/:id
DELETE /reviews/:id
POST   /translations/:id/ratings       { rating, text }
```

### Сповіщення
```
GET    /me/notifications               ?unread=true
PATCH  /me/notifications/:id/read
POST   /me/notifications/read-all
GET    /me/notification-preferences
PUT    /me/notification-preferences    матриця тип × канал
POST   /me/telegram/link               → { deepLink }
DELETE /me/telegram                    відв'язати
POST   /webhooks/telegram              вебхук бота
```

---

## 9. Видимість: матриця доступу

| Ресурс | Власник | Друг | Інший |
|---|---|---|---|
| Профіль | повний | повний | ім'я + аватар |
| Бібліотека `PUBLIC` | ✓ | ✓ | ✓ |
| Бібліотека `FRIENDS` | ✓ | ✓ | ✗ |
| Бібліотека `PRIVATE` | ✓ | ✗ | ✗ |
| Примірник із власною `visibility` | ✓ | за значенням | за значенням |
| Історія примірника з іменами | ✓ | за `showHolderNames` | ✗ |
| Створити запит на позичання | — | ✓ | ✗ |
| Відгуки | ✓ | ✓ | ✓ |

Видимість примірника = **найсуворіше** з видимості бібліотеки та видимості самого примірника.

---

## 10. Ранг перекладів

### 10.1 Проблема

Гола середня оцінка ламається на малих вибірках: переклад із двома п'ятірками обійде переклад із сорока оцінками й середнім 4.6. При кількох десятках користувачів так буде **завжди**.

### 10.2 Формула

Байєсівське згладжування до середнього по твору:

```
score = (v / (v + m)) · R  +  (m / (v + m)) · C
```

- `R` — середня оцінка цього перекладу
- `v` — кількість оцінок цього перекладу
- `m` — поріг довіри, стартове значення **5**, у конфіг
- `C` — середня по всіх перекладах цього твору; якщо переклад один або оцінок немає — глобальна середня

Перерахунок `score`, `ratingAvg`, `ratingCount` — при кожній зміні `TranslationRating`, у тій самій транзакції.

### 10.3 Cold start

При `v < m` числовий ранг **не відображається**. Замість нього — структуровані ознаки, які є фактами, а не думками, і заповнюються при додаванні книги:

- `sourceLang` — з якої мови перекладено. Для української аудиторії найсильніший наявний сигнал: переклад з оригіналу проти переказу з підрядника.
- `isAbridged` — повний чи скорочений.
- `hasNotes` — примітки й коментарі перекладача.
- `year` — рік перекладу; мова старіє.
- Кількість видань цього перекладу — непрямий сигнал: перевидають те, що продається.

Краще не показати нічого, ніж показати 5.0 від однієї людини.

### 10.4 Поза скоупом

Попарні порівняння (Elo / Bradley-Terry) дають точніший результат, бо люди надійніше кажуть «А краще за Б», ніж ставлять абсолютну цифру. Але потрібні люди, які прочитали **обидва** переклади одного твору — у колі друзів таких нуль.

### 10.5 Відображення

На сторінці твору переклади сортуються за `score DESC`. Кожен показує перекладача, мову, `sourceLang`, рік, ознаки чипами, кількість оцінок і — за `v ≥ m` — числовий ранг. Під кожним перекладом список видань із позначкою, у кого з друзів такий примірник є.

---

## 11. Нефункціональні вимоги

- **Продуктивність.** Навантаження низьке. Єдиний потенційно повільний запит — fuzzy-пошук; вирішується GIN-індексом §4.9. Ліміт відповіді пошуку — 20 записів.
- **Консистентність.** Переходи стейт-машини — у транзакціях із `SELECT FOR UPDATE` на `Copy`. Перерахунок агрегатів рейтингів — у тій самій транзакції, що й зміна оцінки.
- **Валідація.** DTO через `class-validator` на кожному ендпоінті. Схеми DTO живуть у `packages/shared` як zod-схеми, спільні для бекенду й фронтенду. `rating` — ціле 1..5. ISBN — з перевіркою контрольної суми.
- **Rate limiting.** На створення `Work` / `Edition` (антиспам каталогу), на запити в друзі, на генерацію Telegram-токенів.
- **Логування.** Кожен перехід лоану: `loanId`, `from`, `to`, `actorId`. Кожна доставка: `deliveryId`, `channel`, `status`, `attempts`.
- **Тести.** Обов'язкове покриття:
  - таблиця переходів §5.1 повністю, включно з негативними кейсами;
  - **конкурентний апрув** — дві паралельні транзакції на один `copyId`, перевірка, що рівно одна дійшла до `APPROVED`;
  - інваріанти §5.3;
  - формула §10.2 на межових значеннях `v`;
  - перевірка авторизації колбеку Telegram (§7.4).

Конкурентний апрув локально **ніколи не зламається**, бо розробник один і клікає послідовно. Це той тест, який не пишеться «потім».

---

## 12. Локальне середовище

### 12.1 Структура

```
apps/
  api/      NestJS
  web/      Next.js
packages/
  shared/   zod-схеми DTO + реекспорт enum'ів Prisma
```

`packages/shared` заводиться порожнім із самого початку. «Поки покладу типи в api, потім винесу» закінчується тим, що фронт імпортує з `apps/api`, і монорепо стає двома застосунками з кільцевою залежністю.

### 12.2 База

У Docker — тільки Postgres. Nest і Next запускаються нативно: hot reload у контейнері на macOS через bind mount помітно повільніший.

```yaml
# docker-compose.yml у корені
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: bookswap
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: bookswap
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Версія образу — та сама, що поїде на VPS. Не `latest`.

`.env` — **один, у корені**. Prisma кладе його в `apps/api`; два різні `.env` для одного `DATABASE_URL` гарантовано розсинхронізуються.

### 12.3 Відомі граблі оточення

Зафіксовано, бо через місяць не відтворюється по пам'яті:

- **`allowBuilds` у `pnpm-workspace.yaml`**, не `onlyBuiltDependencies` і не поле `pnpm` у `package.json` — pnpm 11 переніс налаштування. Пакети, яким потрібен дозвіл: `unrs-resolver`, `@prisma/engines`, `prisma`.
- **`pnpm approve-builds` лишає плейсхолдери** `set this to true or false` — дописувати `назва: true` руками.
- **`pnpm install` пропускає постінстали**, якщо пакети вже на диску. Після зміни `allowBuilds` потрібен `pnpm rebuild`.
- **`packageManager` — точна версія без caret.** `devEngines` із діапазоном ламає всі команди pnpm у теці.
- **`rootDir: "./src"` у `tsconfig.build.json`**, не в базовому: базовий охоплює `test/`, і Jest впаде.
- **`"types": ["node"]`** у `apps/api/tsconfig.json` — TS 6 не підхоплює `@types` автоматично після видалення `baseUrl`. При додаванні тестів стане `["node", "jest"]`.
- **`baseUrl` видалити** — у TS 6 це помилка, а не попередження. `ignoreDeprecations` не використовувати: у TS 7 підтримка зникає остаточно.
- **`*.tsbuildinfo` у `.gitignore`** — інакше інкрементальна збірка «бачить» неіснуючий `dist`.
- **`create-next-app` не створює проміжні теки** — `mkdir -p apps packages` заздалегідь.

---

## 13. Інфраструктура

### 13.1 Цільова конфігурація

| | |
|---|---|
| Сервер | Hetzner Cloud **CAX21** (4 vCPU ARM / 8 GB / 80 GB) |
| Локація | Falkenstein (FSN1) |
| ОС | Ubuntu 24.04 LTS |
| Мережа | Cloud Firewall: відкриті 22, 80, 443 — і більше нічого |
| Бекапи | Hetzner Backups (снапшоти) + `pg_dump` на Storage Box BX11 |

Орієнтовна вартість: ~€15–17/міс разом зі Storage Box та IPv4.

**Чому ARM:** розробка ведеться на Apple Silicon, тому dev і prod мають однакову архітектуру — образи збираються нативно, без `--platform` та емуляції. Це ж вимагає `binaryTargets` у §4.1.

**Чому не DigitalOcean:** еквівалентний дроплет коштує близько вчетверо більше, ARM у базовій лінійці немає. Стартовий кредит $200 на 60 днів — принада: після його вичерпання або платиш вчетверо, або мігруєш у розпал розробки.

**Порт застосунку — через env**, не хардкодом: `app.listen(process.env.PORT ?? 3001)`.

### 13.2 Склад проду

Docker Compose на сервері: `postgres` + `api` + `web` + `caddy`. Caddy термінує TLS і роздає фронт та `/api` з одного домену — це те, що робить session cookie з `SameSite=Lax` достатнім (§6.1).

**Postgres не публікує 5432 назовні** — тільки в Docker-мережу.

### 13.3 Бекапи

Два шари, вони вирішують різні задачі:

- **`pg_dump` на Storage Box щодня** — логічний бекап, дозволяє відновити окрему таблицю. Основний механізм.
- **Снапшоти Hetzner (+20% до ціни сервера)** — рятують від «знищив сервер», не від «дропнув таблицю».

Бекап, який жодного разу не відновлювали, бекапом не є. Перевірка відновлення — раз на квартал, у календар.

---

## 14. Етапи

**Етап 1 — кістяк.** Auth (session cookie, підтвердження пошти), профіль, дружба, `Work`/`Translation`/`Edition`/`Copy` з ручним створенням, особиста бібліотека, перегляд бібліотеки друга. Схема заводиться **вся одразу**, включно з `Loan` і сповіщеннями, навіть якщо код під них ще не написаний.

**Етап 2 — головна фіча.** Стейт-машина лоанів повністю з транзакціями й тестом на конкурентний апрув. Історія примірника й твору. В'ю «мої не вдома» / «чужі в мене». In-app сповіщення.

**Етап 3 — сповіщення назовні.** Email-канал (він же підтвердження пошти й скидання пароля). Диспетчер із `NotificationDelivery` і ретраями. Telegram-бот: прив'язка через deep link, інлайн-кнопки apprоve/reject, вебхук. Щоденна задача для `DUE_SOON` / `OVERDUE`.

**Етап 4 — якість даних.** Fuzzy-пошук перед створенням, автозаповнення за ISBN, мердж дублікатів, вішлист.

**Етап 5 — оцінки.** `Review` на твір, `TranslationRating`, ранг перекладів із cold-start-правилом, ознаки перекладів у UI.

**Поза поточним ТЗ:** оцінка якості видання, ланцюгове позичання, репутація користувача (лічильник вчасних повернень), публічні бібліотеки, імпорт з Goodreads, Web Push.

Порядок не довільний:

- Етап 3 після 2, бо сповіщати нема про що, поки немає переходів.
- Етап 5 після 4, бо рейтинги на недедуплікованому каталозі розмажуться по дублікатах, і мердж доведеться робити разом із перенесенням відгуків.

---

## 15. Рішення, які лишаються за розробником

1. **Поріг `m` у формулі рангу.** Стартове 5 — здогад. Після перших 50 оцінок подивитись розподіл і підкрутити.
2. **Автор як окрема сутність.** У схемі `Author` винесено в таблицю. Дешевша альтернатива — `authors String[]` на `Work`, але тоді немає сторінки автора й дедуплікація імен лягає на UI.
3. **Публічні бібліотеки.** `Visibility.PUBLIC` є в схемі, але UI може її не пропонувати у v1. Схема готова, продуктове рішення відкладене.
4. **Storage для обкладинок.** Локально — файлова система; у проді або та ж ФС на volume, або S3-сумісне сховище. Абстрагувати інтерфейсом одразу, реалізацію обрати пізніше.
5. **Мова інтерфейсу.** Домен явно багатомовний (`origLang`, `lang`, `sourceLang`), але про i18n самого UI рішення не приймалося.