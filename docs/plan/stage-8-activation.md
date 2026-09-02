# Етап 8a — product analytics

**Статус:** реалізовано; 8a-1–8a-4 завершено.
**Джерело:** аудит core-loop funnel (read-only), переглянутий і двічі уточнений
Product Owner.
**Не є:** повним Етапом 8 з `docs/plan/roadmap-v2.md` — barcode/camera scan, CSV
import, послідовне додавання й виправлення метаданих сюди не входять і плануються
окремо.

Позначення «8a» — підетап за зразком `docs/plan/stage-7.md` (`7a`…`7h`), не термін
із roadmap.

---

## 1. Product outcome

Команда може порахувати, на якому кроці core-loop funnel (`docs/plan/roadmap-v2.md`,
§2) зупиняється користувач — **без** покладання на доменні таблиці як єдине джерело
правди, бо `Copy` (`LibraryService.removeCopy`, `apps/api/src/library/library.service.ts:290-313`)
і каскадно `Loan` (`onDelete: Cascade` від `Copy`, `apps/api/prisma/schema.prisma:410`;
LIB-05, `docs/functional-specification.md:138`) та прийнята `Friendship`
(`FriendsService.runTransition`, гілка `delete`, `apps/api/src/friends/friends.service.ts:263-272`)
можуть бути незворотно видалені разом зі своєю історією.

Це не платформа аналітики. Це один додатковий запис поруч із вже наявними доменними
мутаціями, з гарантією, що: (а) він ніколи не змінює результат і не заважає
успішності користувацької дії, і (б) він переживає видалення сутностей, які його
спричинили.

---

## 2. Модель даних

```prisma
model ProductEvent {
  id            String   @id @default(cuid())
  type          String   // закритий набір із §4, валідується в apps/api/src/analytics/**
  properties    Json     // див. §4 — для більшості типів завжди {}
  schemaVersion Int      @default(1)
  dedupeKey     String   @unique // opaque/pseudonymous, див. §2.2
  occurredAt    DateTime @default(now())

  subjectUserId String?
  subjectUser   User?    @relation(fields: [subjectUserId], references: [id], onDelete: SetNull)

  @@index([type, occurredAt])
  @@index([subjectUserId, type])
}
```

### 2.1 `subjectUserId` — навмисне відхилення від конвенції

Усі інші моделі каскадно видаляються разом із `User`. Тут — `onDelete: SetNull`:
подія повинна пережити видалення користувача (Stage 13 ще не визначив retention для
account deletion, `docs/functional-specification.md:536`, §12.2 п.4), а агрегати
(«скільки `LOAN_RETURNED` за тиждень») не мають ставати неправильними, коли один
користувач із когорти видалить акаунт.

Для подій Stage 8a `subjectUserId` **очікується завжди заповненим** — усі сім типів
§4 виникають із дії конкретного автентифікованого користувача. Якщо колись (поза
8a) з'явиться подія без явного суб'єкта, у формулі `dedupeKey` (§2.2) на місці
`subjectUserId` використовується стабільний маркер-рядок `"-"`, а не `null` чи
порожній рядок — щоб хеш лишався детермінованим і читабельним при діагностиці.

### 2.2 `dedupeKey` — opaque/pseudonymous, без domain ID у відкритому вигляді

Domain-ідентифікатори (`loanId`, `copyId`, `friendshipId`, `userId`) **ніде не
зберігаються** в `ProductEvent` у відкритому вигляді, окрім `subjectUserId`. Вони
йдуть лише як вхід одностороннього хешу:

```
dedupeKey = sha256(
  "bookswap-product-event:v1:" +
  eventType + ":" +
  domainEntityId + ":" +
  subjectUserId
)
```

Секретна сіль не використовується — вона не потрібна тут: мета хешу не
криптографічний захист, а (1) приховати сирий domain ID від будь-кого, хто читає
`ProductEvent` напряму, і (2) дати детермінований унікальний ключ для ідемпотентності
after-commit виклику (§3).

**Точне формулювання, без перебільшення.** Це **opaque/pseudonymous representation**,
не анонімізація. Без солі й без секрету хеш **не захищає від equality check**: якщо
хтось уже знає конкретний `loanId` і `subjectUserId`, він може порахувати той самий
SHA-256 і підтвердити, що подія про цей самий `loanId` існує. Хеш ховає ID від
пасивного читання таблиці, але не є криптографічним доказом непов'язаності. Це
свідомо прийнятний рівень захисту для внутрішньої аналітичної таблиці без
публічного доступу (§7: жодного ingestion- чи read-endpoint у 8a немає).

### 2.3 `occurredAt`, не `createdAt`

Усі інші моделі схеми використовують `createdAt` як загальний технічний audit-штамп
рядка (`User.createdAt`, `Copy.createdAt` тощо). `ProductEvent.occurredAt` навмисно
названо інакше: це не момент вставки рядка як такий (хоча в 8a вони практично
збігаються, бо запис синхронний і відбувається одразу після коміту, §3), а момент
**продуктової події**, яку рядок фіксує. Розрізнення важливе для читача звіту й для
майбутнього стрімінгу цієї таблиці назовні (аудит, розділ «Порівняння варіантів»,
Варіант B): «коли сталася подія» і «коли її записали» — різні поняття, навіть якщо
зараз вони рівні з точністю до мілісекунд.

### 2.4 `schemaVersion`

За прецедентом `apps/api/src/common/enum-parity.spec.ts`: властивості типу події
можуть змінити форму між релізами; звіт і майбутні читачі мусять знати, яку форму
читають. Дефолт `1`, інкремент — за зміни форми `properties` для конкретного `type`.

### 2.5 Розташування типів і схем валідації

Enum типів події та Zod-схеми `properties` для кожного типу живуть у
`apps/api/src/analytics/**` (нова директорія модуля), **не** в `packages/shared`.
На відміну від `NotificationType` (`packages/shared/src/domain/notification.ts`),
у product events немає ні публічного ingestion endpoint, ні read-endpoint, ні
frontend-споживача — таксономія повністю внутрішня для `apps/api`, і виносити її в
спільний пакет означало б публічну поверхню, якої не існує.

---

## 3. Гарантії доставки

**Точне формулювання.** Запис у `ProductEvent` відбувається **після успішного
коміту** доменної транзакції, через `await AnalyticsService.record(...)`. Це не
атомарний запис у тій самій транзакції — і саме тому збій запису ніколи не
відкочує доменну мутацію: до моменту виклику `record()` дані вже незворотно
закомічені.

- Виклик — синхронний `await`, у тому самому request-циклі, одразу після коміту, у
  тому самому місці, де вже викликається `notifications.dispatchSoon()`
  (наприклад `apps/api/src/loans/loan.service.ts:240` і `:288`,
  `apps/api/src/friends/friends.service.ts:167`).
- `AnalyticsService.record()` ловить будь-яку власну помилку (валідація
  `properties`, збій `INSERT`, недоступність БД) усередині себе й ніколи не кидає
  назовні. Помилка йде в `Logger.warn`. **Гарантія — саме така: результат і
  успішність доменної операції ніколи не змінюються через збій аналітики.**
- **Чесно про latency.** Оскільки виклик — `await`, він додає **один DB
  round-trip** до часу відповіді кожного інструментованого запиту, перш ніж
  контролер поверне HTTP-відповідь. Формулювання «ніколи не блокує» тут навмисно
  не вживається — воно неправдиве: виклик синхронний і додає затримку. Правдива
  гарантія вужча й саме вона обрана: **не змінює результат, не ламає й не відкочує
  доменну операцію**, ціною одного додаткового round-trip у відповіді.
- На відміну від `AuthService`'s `enqueueEmail`/`activeEmailJobs`
  (`apps/api/src/auth/auth.service.ts:73-96`), тут не заводиться окремий облік
  фонової роботи для graceful shutdown: виклик не мережевий (без провайдера, який
  може зависнути), завершується в межах того самого `await`, і завжди встигає або
  відпрацювати, або впасти й бути пійманим до того, як функція-викликач поверне
  керування.
- Наслідок: якщо процес аварійно завершується рівно між комітом домену і викликом
  `record()`, подія втрачається. Це прийнятно й узгоджено з рішенням «без
  historical backfill» (§9) — funnel явно best-effort, а не exactly-once журнал.

---

## 4. Event taxonomy

Рівно сім типів. Жодних інших у 8a.

| `type` | `properties` | `subjectUserId` |
|---|---|---|
| `SIGNUP_COMPLETED` | `{}` | новий користувач |
| `BOOK_ADDED` | `{ method: 'MANUAL' \| 'BARCODE' \| 'CSV' }` | власник копії |
| `FRIEND_ACCEPTED` | `{}` | **дві події**: одна з `subjectUserId = userAId`, друга з `subjectUserId = userBId` (§5) |
| `LOAN_REQUESTED` | `{}` | позичальник |
| `LOAN_APPROVED` | `{}` | позичальник (суб'єкт funnel-кроку — той, чий запит апрувнули) |
| `LOAN_HANDED_OVER` | `{}` | позичальник |
| `LOAN_RETURNED` | `{}` | позичальник |

`method` у `BOOK_ADDED` — єдине поле `properties` в усій таксономії 8a. У 8a
завжди `'MANUAL'` (barcode/CSV ще не існують); enum уже включає `'BARCODE'`/`'CSV'`,
щоб Stage 8b/8c не мігрували схему, а лише додали виклик з іншим значенням.

**Не входить у 8a** (§7): `LIBRARY_MILESTONE_REACHED`, `SECOND_LOAN_STARTED`,
`FRIEND_INVENTORY_USABLE`, `SEARCH_FOUND`, будь-який generic client-side endpoint.

«Перша книга» / «десята книга» / «друга позика» — не окремі типи подій, а
**підрахунок** `BOOK_ADDED`/`LOAN_REQUESTED` по `subjectUserId` у CLI-звіті (§6):
n-та `BOOK_ADDED` за `occurredAt` для користувача = момент перетину порогу «N
книжок» **серед подій, які реально записалися** — це наближення, а не точне число
книжок на полиці зараз (яке `Copy`-таблиця й так дає для операційних потреб).

---

## 5. Integration points (after-commit)

| Подія | Файл:рядок | Момент виклику |
|---|---|---|
| `SIGNUP_COMPLETED` | `apps/api/src/auth/auth.service.ts:371-417` (`register()`) | Після того, як `await this.runWorkflow('реєстрація', ...)` **повернув** `Authenticated` — тобто після виходу з `runWorkflow`, чий `finally`-блок (`apps/api/src/auth/auth.service.ts:250-264`, `runWorkflow`) уже викликав `reservation.release()`. Виклик аналітики стоїть **зовні** callback'а `runWorkflow`, не всередині нього: `register()` набуває вигляду «`const result = await this.runWorkflow(...); await this.analytics.record(...); return result`». Це і є «після того, як увесь workflow повернув `Authenticated`, а permit уже звільнений» — включно з `sessions.create()` (рядок 416), який стається всередині callback'а раніше. |
| `BOOK_ADDED` | `apps/api/src/library/library.service.ts:200-222` (`addCopy()`) | Після успішного `await this.prisma.copy.create(...)` (рядки 208-219), перед `return`. |
| `FRIEND_ACCEPTED` | `apps/api/src/friends/friends.service.ts:158-170` (`apply()`) | Після `await this.runWithRetry(...)` (рядок 163), лише коли перехід щойно встановив `ACCEPTED` (перевірено на `resolveTransition`/`notify()`, `friends.service.ts:274-300` і `:333-339`; поточний `apply()` повертає лише `relation: FriendRelation`, тож для доступу до `userAId`/`userBId` пари `runTransition`/`apply()` має додатково повернути обидва id поруч із `relation` — мінімальна зміна сигнатури повернення, не новий компонент). Викликається **двічі**: `AnalyticsService.record({ type: 'FRIEND_ACCEPTED', subjectUserId: userAId, domainEntityId: friendshipId })` і те саме з `userBId`. |
| `LOAN_REQUESTED` | `apps/api/src/loans/loan.service.ts:133-243` (`request()`) | Після `await this.prisma.$transaction(...)` (коміт транзакції завершується на рядку 233), у тому самому місці, де вже стоїть `this.notifications.dispatchSoon()` (рядок 240). |
| `LOAN_APPROVED` / `LOAN_HANDED_OVER` / `LOAN_RETURNED` | `apps/api/src/loans/loan.service.ts:256-291` (`apply()`) | Після `outcome = await this.runTransition(...)` (рядок 260), у тому самому місці, де вже стоїть `this.notifications.dispatchSoon()` (рядок 288). Тип події вибирається за `outcome.to` (`'APPROVED'|'HANDED_OVER'|'RETURNED'`); для `REJECTED`/`CANCELLED`/`LOST` подія не пишеться — це поза таксономією §4. |

Усі точки — вже наявні after-commit хуки (`dispatchSoon()`) або природне
завершення виклику (`register()`, `addCopy()`), тож `AnalyticsService`
підключається туди ж, а не потребує нових точок виходу з транзакцій.

**Модуль:** новий `apps/api/src/analytics/` за структурою, аналогічною
`notifications/`: `analytics.module.ts`, `analytics.service.ts`, `product-event.types.ts`
(enum типів + Zod-схеми `properties` на кожен тип, §2.5), `dedupe-key.ts` (чиста
функція хешування §2.2 — тестована без Prisma й без Nest, за зразком
`friendship.transitions.ts`/`loan.transitions.ts`).

---

## 6. CLI contract

```
pnpm --filter @bookswap/api run funnel:report \
  --from YYYY-MM-DD --to YYYY-MM-DD --window-days 60 [--json]
```

- `--from`/`--to` — межі **когорти реєстрації**: у вибірку йдуть користувачі, чий
  `SIGNUP_COMPLETED` стався в цьому діапазоні.
- `--window-days` — скільки днів після `signup` конкретного користувача
  зараховується як «час на конверсію» для кожного наступного кроку. Значення задає
  виклик, а не код: за `roadmap-v2.md:49` — «до отримання baseline roadmap не
  встановлює вигаданих conversion targets», тож дефолтного вікна в коді немає,
  прапорець обов'язковий.
- `--json` — машиночитний вивід (для майбутнього дашборда чи CI), без ASCII-таблиці.

**Active user** (для тимчасових метрик North Star, §6.2) — будь-який
`subjectUserId`, що має принаймні одну подію з §4, **окрім** `SIGNUP_COMPLETED`, у
звітному вікні. Сам факт реєстрації не робить користувача «активним» — це мало б
сенс лише для funnel-кроку 1, а не для метрики активності мережі.

### 6.1 Порожня таблиця

Якщо в `ProductEvent` немає жодного рядка, звіт друкує рівно:

```
Analytics coverage: no product events recorded yet.
The funnel report cannot be calculated.
```

і завершується без спроби порахувати відсотки чи метрики (код виходу — не помилка
процесу, а порожній, валідний результат: аналогічно до `merge-works.ts`, де код `0`
означає «команда виконалася», а не «є дані для друку»).

### 6.2 Непорожня таблиця — приклад виводу

```
Когорта 2026-08-17 – 2026-08-23 (реєстрацій: 41), вікно конверсії: 60 днів
Earliest stored analytics event: 2026-09-02

  1. signup                          41   100%
  2. book_added (перша)              33    80%
  3. book_added (10-та)              12    29%
  4. friend_accepted                 29    71%
  5. friend_inventory_became_usable  —    not instrumented — Stage 9
  6. friend_book_found               —    not instrumented — Stage 9
  7. loan_requested                   7    17%
  8. loan_approved                    6    15%
  9. loan_handed_over                 6    15%
 10. loan_returned                    5    12%
 11. loan_requested (2-га)            2     5%

Тимчасові метрики (до Circle/network entity, Stage 9/14):
  successful returned loans, total:        5
  successful returned loans, per active user: 0.18  (active users: 28)

Cross-check із доменними таблицями (діагностичний, не funnel):
  BOOK_ADDED (events) vs Copy.createdAt (domain), той самий період:
    event-only: 2   domain-only: 0   (event-only — очікуваний результат після
                                       hard delete Copy: подія пережила рядок)
```

Кроки 5–6 виводять буквальний рядок `not instrumented — Stage 9` — жодних цифр,
навіть нульових чи оцінних. «Active network» (roadmap North Star) не рахується до
появи Circle-сутності (Stage 9/14); замість неї — `successful returned loans total`
і `per active user` за визначенням активного користувача з §6. Cross-check показує
**обидва** напрямки розбіжності (`event-only`, `domain-only`) окремо, не єдиний
«mismatch»-прапорець: `ProductEvent > domain` — очікуваний результат hard delete
(§1), не баг; `domain > ProductEvent` — сигнал пропущеного call site чи втраченої
after-commit події, вартий розслідування.

### 6.3 Когорта старіша за перші дані

Якщо `--from` когорти передує найранішому збереженому `ProductEvent.occurredAt`,
звіт друкує рівно (дата — фактичний `MIN(ProductEvent.occurredAt)`, назване
**earliest stored analytics event**, а не «coverage starts»: це формулювання не
обіцяє повного покриття з цієї дати, лише називає межу наявних даних):

```
WARNING: cohort starts before the earliest stored analytics event (<date>).
Funnel counts may be incomplete. No historical backfill was performed.
Use --from <date> or later for a fully instrumented cohort.
```

Обидва рядки виводу (§6.1 і §6.3) — фіксований літерал англійською, не
локалізується: це діагностичний текст для інженерів/операторів, аналогічний
машиночитним `code` в API-помилках (`packages/shared/src/errors.ts`), а не
користувацький UI-текст.

---

## 7. Явне «Не робити» в 8a

- Не створювати `LIBRARY_MILESTONE_REACHED` і `SECOND_LOAN_STARTED` — рахунок
  через `BOOK_ADDED`/`LOAN_REQUESTED` у CLI.
- Не реалізовувати `FRIEND_INVENTORY_USABLE` — стан читається (`listOf()`), а не
  мутується; запис аналітики з GET-шляху не робиться в 8a.
- Не реалізовувати `SEARCH_FOUND` і будь-яку client-side подію.
- Не створювати `POST /analytics/track` чи будь-який інший публічний endpoint
  прийому подій.
- Не писати жодного `ProductEvent` під час обробки GET-запиту.
- Не виносити типи подій чи Zod-схеми в `packages/shared` (§2.5).
- Не вживати секретну сіль у `dedupeKey` і не називати його анонімізацією (§2.2).
- Не робити historical backfill минулих подій із доменних таблиць.
- Не встановлювати автоматичний TTL/retention для `ProductEvent` — це рішення
  Stage 13 разом з account deletion.
- Не обчислювати «active network» як граф/компоненту зв'язності — до Stage 9/14.
- Не чіпати barcode/camera scan, CSV import, послідовне додавання, виправлення
  метаданих, onboarding-чекліст — інші частини Етапу 8, не 8a.
- У межах цього документа: не змінювати Prisma-схему, API-код, web,
  `packages/shared`, `package.json` чи тести — лише план.

---

## 8. План міграції

Одна майбутня Prisma-міграція: нова таблиця `ProductEvent` (§2), без зв'язків із
жодною існуючою моделлю, окрім `subjectUserId → User` (`onDelete: SetNull`).
Жодна наявна таблиця не змінюється. Ризик для наявних даних — нульовий: додається
таблиця, нічого не альтерується.

Historical backfill — свідомо не робиться (§9 нижче): дані для нього або відсутні,
або пошкоджені попередніми hard delete, а вдавана точність гірша за чесну
відсутність даних до дати покриття.

---

## 9. Historical backfill і межа наявних даних

Не виконується. CLI (§6.3) явно друкує `Earliest stored analytics event: <дата>`,
де дата — `MIN(ProductEvent.occurredAt)` по всій таблиці на момент запуску звіту.
Термін навмисно не «coverage starts»: він не стверджує, що з цієї миті покриття
повне для будь-якої когорти, лише називає межу, раніше якої даних гарантовано
немає.

---

## 10. Retention та account deletion

Тимчасово без автоматичного TTL — обсяг подій на масштабі `docs/specification.md`
§1 («десятки-сотні користувачів») мізерний, і передчасне видалення зробило б
funnel-звіт неповним без продуктової причини. Остаточні правила retention і
поведінка при видаленні акаунта — предмет execution plan Stage 13. Модель уже
готова до цього рішення: `onDelete: SetNull` (§2.1) гарантує, що видалення `User`
не видаляє агрегати, а лише знеособлює конкретні рядки.

---

## 11. Тести

- **Unit, `AnalyticsService.record()`:** будь-яка внутрішня помилка (невалідні
  `properties`, помилка БД) ловиться й ніколи не прокидається назовні; метод завжди
  повертає resolved promise незалежно від успіху запису.
- **Unit, `dedupeKey`:** чиста функція хешування (§2.2) — детермінована на
  однакових вхідних, різна на різних `subjectUserId` для тієї самої пари
  `eventType`+`domainEntityId` (перевіряє коректність двох подій `FRIEND_ACCEPTED`
  з різними ключами).
- **e2e, результат домену не змінюється при збої аналітики** (новий файл; на
  відміну від `test/loans-rollback.e2e-spec.ts`, тут перевіряється **протилежне**
  твердження — збій НЕ впливає, а не «мусить відкотити разом»): підмінити
  `PrismaService.productEvent.create` **test double/mock**, що примусово відхиляє
  Promise, і довести, що `register`/`addCopy`/friend accept/loan-перехід усе одно
  повертають успіх і повністю застосовують доменну мутацію. Мокати саме виклик
  Prisma-моделі, а не намагатися спровокувати збій через невалідний `dedupeKey` —
  `String`-колонка Prisma не має обмеження, яке дало б природний конфлікт без
  штучного дублювання ключа.
- **e2e, порядок виклику `SIGNUP_COMPLETED`:** шпигун на `AnalyticsService.record`
  фіксує момент виклику; тест підтверджує, що він стається **після** того, як
  `sessions.create()` уже повернув токен і `runWorkflow` уже викликав
  `release()` — не раніше.
- **Ідемпотентність:** два виклики after-commit хука з тим самим доменним
  ідентифікатором (симуляція повторної спроби) дають рівно один рядок
  `ProductEvent` — унікальний індекс на `dedupeKey`.
- **DB-тест, ключовий для §1 обґрунтування:** створити `Copy` → `BOOK_ADDED`
  записаний → видалити `Copy` (`removeCopy`) → рядок `ProductEvent` лишається
  незмінним (жодного FK на `Copy` немає — переживає видалення структурно, не
  завдяки якійсь спеціальній обробці).
- **DB-тест на `SetNull`:** видалити `User` (у межах наявних каскадів) →
  `ProductEvent.subjectUserId` стає `NULL`, рядок не видаляється.
- **CLI, unit:** розрахунок вікна конверсії, N-та `BOOK_ADDED`/`LOAN_REQUESTED` на
  користувача, `not instrumented — Stage 9` для кроків 5–6, формат cross-check
  (event-only/domain-only окремо), точний текст порожньої таблиці (§6.1) і
  попередження про когорту старішу за `earliest stored analytics event` (§6.3),
  визначення active user (§6, без `SIGNUP_COMPLETED`).

---

## 12. Розбиття на підетапи

- **8a-1 — завершено.** Модуль `apps/api/src/analytics/` (§5): схема
  `ProductEvent` (міграція, `occurredAt`, `subjectUserId`/`SetNull`) +
  `AnalyticsService.record()` (best-effort, §3) + `dedupe-key.ts` (§2.2) + enum
  типів і Zod-схеми `properties` (§2.5), без жодного call site. DB-тести на
  `SetNull` і на відсутність FK до `Copy`/`Loan`/`Friendship`.
- **8a-2 — завершено.** Інтеграція `SIGNUP_COMPLETED` (зовні `runWorkflow`, §5) і `BOOK_ADDED`
  (`method: 'MANUAL'`). e2e на незмінність результату при збої аналітики й на
  порядок виклику.
- **8a-3 — завершено.** Інтеграція `FRIEND_ACCEPTED` (дві події, §4-§5, зі зміною сигнатури
  повернення `runTransition`/`apply()` для доступу до `userAId`/`userBId`) і
  чотирьох `LOAN_*` подій. e2e покриває кожен integration point, after-commit
  порядок, borrower як subject, відсутність подій для неінструментованих переходів
  і незмінність доменного результату при збої аналітики.
- **8a-4 — завершено.** CLI `funnel:report` повністю: `--from/--to/--window-days/--json`,
  точні тексти §6.1 і §6.3, «not instrumented» для 5–6, тимчасові метрики North
  Star з визначенням active user (§6), cross-check event-only/domain-only. Unit-тести
  покривають аргументи, per-user conversion window, N-ті події, порожній результат,
  coverage warning, обидва напрямки cross-check і JSON-представлення.

Кожен підетап — окремий коміт з власними тестами, без переходу до наступного без
підтвердження.

---

## 13. Definition of done

- `ProductEvent` записується after-commit у всіх точках §5 (вісім викликів:
  сім типів, з них `FRIEND_ACCEPTED` — двічі), best-effort; e2e-тестом доведено,
  що жодна з них не змінює результат чи успішність батьківської операції.
- `SIGNUP_COMPLETED` документовано й тестово підтверджено як виклик **зовні**
  `runWorkflow`, після звільнення permit, а не всередині callback'а.
- `subjectUserId` — `SetNull` при видаленні `User`; сама подія ніколи не має FK на
  `Copy`/`Loan`/`Friendship`.
- Жоден `properties` не містить нічого, крім `method` у `BOOK_ADDED`; для решти —
  завжди `{}`.
- `dedupeKey` рахується за формулою §2.2 (без солі), і документація явно називає
  його opaque/pseudonymous, не анонімізацією.
- Поле часу події зветься `occurredAt` (§2.3), і всі посилання (модель, CLI, тести)
  узгоджені на цій назві.
- Типи подій і Zod-схеми живуть у `apps/api/src/analytics/**`, не в
  `packages/shared`.
- CLI видає точні тексти §6.1 (порожня таблиця) і §6.3 (когорта старіша за дані),
  формулювання `Earliest stored analytics event`, «not instrumented — Stage 9»
  для неінструментованих кроків, і роздільний cross-check.
- Немає жодного нового публічного endpoint прийому подій.
- Немає жодного запису аналітики з GET-шляху.
- `pnpm lint`, `typecheck`, `test`, `test:db`, `build` — зелені (перевіряється по
  завершенні кожного підетапу з коду, не в межах цього документа).

---

## 14. Етап 8a завершено

Усі продуктові й інженерні розвилки з попередніх раундів аудиту закриті рішеннями
1–16 (перший раунд правок) і 1–12 (цей раунд, включно з алгоритмом `dedupeKey`,
подвійним `FRIEND_ACCEPTED`, позицією виклику `SIGNUP_COMPLETED`, точним
формулюванням гарантій доставки, розташуванням таксономії, визначенням active
user, точними текстами CLI, механізмом non-blocking-failure тесту та назвою поля
`occurredAt`). 8a-1–8a-4 реалізовано (§12). Подальші частини Етапу 8 виконуються
окремо за активним `docs/plan/roadmap-v2.md`; цей execution plan закрито.
