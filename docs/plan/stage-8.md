# Етап 8 — Review, TranslationRating і Bayesian ranking (чернетка)

Нарізка на підетапи по одному коміту. Порядок обов'язковий: 8a дає схему для всіх,
8b дає формулу для 8c/8d/8e, 8e потрібен для 8g.

> **Статус: чернетка, не готова до реалізації.** Рекомендації Q1–Q2 та блокери
> Q3–Q5 треба затвердити до початку 8a. Після цього рішення R1–R11 і Definition
> of done слід синхронізувати з обраною стратегією та лише тоді вважати план
> робочим.

**Передумова: борг флаку e2e закритий.** Етап 8 містить тести на транзакції,
rollback і конкурентність — без довіри до гейта вони нічого не доводять.

---

## 0. Звірка чернетки з фактичною схемою

Звірено на `feat/stage-8-ratings`, 2026-08-24. Чернетка писалася до того, як стало
видно фактичний стан `apps/api/prisma/schema.prisma`, і розійшлася з ним у десяти
місцях. Нижче — що є насправді; DoD 8a нижче переписаний під це.

| Твердження чернетки | Фактично в репозиторії |
| --- | --- |
| `TranslationRating` треба завести | **Вже є, і не з 7g, а з першої міграції** `20260815120206_init`. Поля: `id`, `translationId`, `userId`, `rating Int`, `text String?`, `createdAt`. |
| unique `(userId, translationId)` | Є: `@@unique([translationId, userId])`, індекс `TranslationRating_translationId_userId_key`. Пара та сама, порядок полів інший — переробляти нема чого. |
| `updatedAt` | **Немає.** Треба додати: R2 робить POST ідемпотентним upsert'ом, тобто оцінка редагується, і без `updatedAt` рядок не відрізнити від щойно створеного. Це відхилення від §4.7 — там поля немає, бо §4.7 не передбачала редагування оцінки перекладу. |
| CHECK `rating BETWEEN 1 AND 5` у БД | **Немає** — ні на `TranslationRating`, ні на `Review`. Коментар `/// 1..5` у схемі є, обмеження немає. Треба додати обидва. |
| `Translation.ratingAvg` nullable, `score` nullable, `ratingCount` default 0 | Фактично **всі три NOT NULL з дефолтом**: `score Float @default(0)`, `ratingAvg Float @default(0)`, `ratingCount Int @default(0)`. Див. R3 — рішення переглянуте. |
| `Translation.scoreBasis` | **Немає.** Це не «загубилося», це нове поле, якого немає ні в §4.4, ні в §10.2. Див. R5. |
| `Work.ratingAvg` / `ratingCount` | Є: `Float @default(0)` / `Int @default(0)`, NOT NULL. Узгоджені з R9 без правок. |
| індекс під `(workId, score DESC)` | **Немає.** Є `@@index([workId, lang])`. Поки `sortTranslations()` сортує в пам'яті, цей індекс не матиме споживача; повернутися до нього треба лише разом із сортуванням у SQL. |
| `Review` — заводити з нуля | **Багатша за припущення чернетки**: уже має `updatedAt`, `archivedAt`, `archivedByMergeSourceId` і частковий unique `one_active_review_per_work_user WHERE "archivedAt" IS NULL` (міграція `20260822074936_review_archive_on_merge`). **R1 уже підпертий схемою** — 8a на нього не витрачає нічого. |
| контракти Review / TranslationRating / ранжований Translation у `packages/shared` | Немає жодного. `translationSchema` є і **навмисно** без `score`/`ratingAvg`/`ratingCount` — коментар у `contracts/catalog.ts` прямо каже «Ранг приїде разом зі §10 на етапі оцінок». |

Ще три речі, що виявилися при звірці й впливають на нарізку:

1. **`GET /works/:id/translations` уже існує** (реєстрація маршруту —
   `catalog.controller.ts`) і вже сортує за `score DESC` через `sortTranslations()`
   (сама функція й виклик — `catalog.service.ts`, не контролер).
   8e не заводить ендпоінт, а **розширює** наявний. Тай-брейк там уже є й
   покритий тестом, який фіксує порядок за роком при рівних score. Див. R10.
2. **Поточний catalog e2e-тест прямо перевіряє відсутність `score` у відповіді.**
   8e змінює цю перевірку під нову форму (score є, але `null` при
   `rankReliable = false`). Це не «зламаний тест», а свідома зміна контракту;
   посилання на номер рядка навмисно не фіксується, бо воно швидко застаріває.
3. **`MergeService.TransactionClient`** звужений до
   `'work' | 'translation' | 'edition' | 'review' | 'wishlistItem' | '$queryRaw' | '$executeRaw'`.
   8h додає туди `translationRating`, і це навмисно видима зміна: перелік показує,
   до чого мерж має право торкатися.

### Розвилка `text`, яку закриває специфікація

Промпт етапу 8 про `text` у `TranslationRating` мовчить, і це виглядало як
відкрита розвилка. Її закриває сама специфікація, а не наш вибір:

- §4.7 заводить `text String?` у моделі;
- §8, блок «Оцінки», прямо пише `POST /translations/:id/ratings { rating, text }`.

Код і документ **не суперечать** одне одному — мовчить лише промпт етапу. За
правилом CLAUDE.md («коли код і спека розходяться — правий документ») тут навіть
немає що розв'язувати: поле лишається, контракт його віддає, DTO приймає.
Видалення поля було б руйнівною зміною проти §4.7 без жодної підстави.

---

## Рішення, які треба затвердити до старту

- **R1. Архівовані рецензії (з R5 етапу 7g).** Review з `archivedAt != null` не читається,
  не редагується, не видаляється через API і не входить у `Work.ratingAvg/ratingCount`.
  Наявність архівованої рецензії не блокує створення нової — unique частковий.
  *Схемою вже забезпечено (7g). 8a тут не робить нічого.*
- **R2. Форма API оцінки перекладу.** `POST /api/v1/translations/:id/ratings` — ідемпотентний
  upsert (створює або оновлює власну оцінку), `DELETE /api/v1/translations/:id/ratings/me` —
  видалення. Окремого PATCH немає: один користувач — одна оцінка, ресурс адресується власником.
  `DELETE` — доповнення до §8 (там його немає), і воно вимушене: DoD 8g вимагає
  «зняття оцінки доступне», а промпт етапу — «створи, зміни або **видали** rating».
- **R3. Де живе score. `Float NOT NULL DEFAULT 0` у БД, nullable у контракті.**
  ~~Nullable-колонки~~ — чернетка пропонувала nullable; переглянуто після звірки.
  Підстави:
  1. Колонки вже існують як NOT NULL DEFAULT 0 і вже читаються кодом
     (`sortTranslations`). Міняти нульність — зайва міграція без виграшу.
  2. `score` **завжди визначений**: при `v = 0` формула дає `score = C`, а `C`
     завжди має значення через каскад R5 аж до `NEUTRAL`. Стану «score невідомий»
     у домені немає, тож nullable-колонка виражала б неіснуючий стан.
  3. «Немає оцінок» уже виражене через `ratingCount = 0` — другого способу сказати
     те саме не треба.
  Cold start (§10.3) живе **в контракті**, не в колонці: `score` у відповіді
  `number | null`, і сервер віддає `null` при `v < m`. Так UI фізично не може
  показати ранг, якому не можна вірити (DoD 8e).
  **Наслідок, який треба закрити:** новий `Translation`, доданий до твору, де вже є
  оцінки, отримає `score = 0` за дефолтом і провалиться в кінець сортування, хоча
  за формулою мав би отримати `C`. Тому `createTranslation` (8e) **зобов'язаний**
  викликати перерахунок твору в тій самій транзакції.
- **R4. Поріг m.** `RATING_PRIOR_M`, дефолт 5, читається на момент перерахунку. Зміна m
  не перераховує історію — для цього CLI-команда з 8h.
- **R5. Що таке C.** Каскад:
  1. `WORK` — pooled mean по Work: сума всіх оцінок усіх Translation цього Work / їх кількість.
     Використовується, коли в Work ≥ 2 Translation і є хоч одна оцінка.
  2. `GLOBAL` — середня по всіх Translation у базі. Використовується, коли Translation одна
     або в Work немає жодної оцінки.
  3. `NEUTRAL` — 3.0, коли в базі немає жодної оцінки взагалі.
  Середня середніх не використовується — вона перезважує переклади з однією оцінкою.
  **Чи записувати гілку в колонку `Translation.scoreBasis` — відкрите питання,
  див. «Питання до затвердження», Q1.** Сама функція вибору повертає гілку в
  будь-якому разі: без неї unit-тест 8b не відрізнить `WORK` від `GLOBAL`, коли
  обидва дали близькі числа.
- **R6. Конкурентність. `SELECT "id" FROM "Work" WHERE "id" = $1 FOR UPDATE`
  всередині транзакції, ізоляція READ COMMITTED.** ~~pg_advisory_xact_lock~~ —
  чернетка пропонувала advisory lock; переглянуто. Підстави:
  1. **Композиція з мержем (8h).** `MergeService.lockWorks()` уже бере `FOR UPDATE`
     на рядках `Work`. 8h вимагає, щоб мерж кликав перерахунок **у тій самій
     транзакції**. Якщо перерахунок братиме advisory lock, у системі стане два
     незалежні простори блокувань на один і той самий ресурс — а це рівно та
     конфігурація, з якої виростають дедлоки. З `FOR UPDATE` лок уже в руках, і
     перерахунок усередині мержу просто нічого не чекає.
  2. **Ідіома репозиторію.** `LoanService.lockCopy`, `TelegramLinkService`,
     `MergeService.lockWorks` — усі три беруть рядкові локи. Advisory lock був би
     четвертим механізмом на ту саму задачу.
  3. **`pg_advisory_xact_lock` приймає `bigint`,** а `Work.id` — cuid. Знадобився б
     хеш cuid → int64, тобто рукотворна можливість колізії двох різних творів на
     одному локу. `FOR UPDATE` бере рядок, який і є ресурсом.
  Лок береться **до будь-якого INSERT/UPDATE/DELETE** Review або
  TranslationRating, а не лише перед читанням агрегатів. Після локу треба повторно
  перевірити зв'язок Translation → Work і канонічність Work, щоб конкурентний
  merge не залишив запис на старому творі. Порядок при кількох творах —
  `ORDER BY "id"`, як у `lockWorks`.
- **R7. Права й коди.** Недостатньо прав → 403 з `REVIEW_NOT_ELIGIBLE` / `RATING_NOT_ELIGIBLE`.
  Loan у статусі REQUESTED/APPROVED/HANDED_OVER права не дає — тільки RETURNED.
- **R8. Змержені Work (з 7h).** Запис на змержений Work → 409 `WORK_MERGED` через
  наявний `CanonicalWorkService.assertCanonical()`. Читання рецензій — 301 через
  `redirectToCanonicalWork()`. Рецензія й оцінка завжди прив'язуються до канонічного Work.
- **R9. Work.ratingAvg / ratingCount рахуються з Review**, не з TranslationRating.
  Активних (`archivedAt IS NULL`), за R1.
- **R10. Тай-брейк ранжованого списку: `score DESC, ratingCount DESC, year ASC
  (NULLS LAST), id ASC`.** Чернетка пропонувала `ratingCount DESC, id ASC`; сюди
  вставлено наявний критерій за роком, бо він уже реалізований
  у `sortTranslations()` і покритий catalog e2e-тестом сортування за роком.
  Викидати робочий детермінований критерій заради коротшого списку немає підстав;
  `ratingCount DESC` стає **перед** ним, як і просила чернетка.
- **R11. Де живе rating у контракті.** `translationSchema` **розширюється**
  (`score: number | null`, `ratingCount`, `rankReliable`, `myRating: number | null`),
  а не дублюється окремою `rankedTranslationSchema`. Це робиться в **8e разом
  з усіма catalog mapper/API-змінами**, а не в 8a: інакше обов'язкові нові поля
  одразу зламають наявний `toTranslation()`. Підстава: `translationSchema` вже
  входить і в `workDetailResponseSchema`, і в `translationListResponseSchema`,
  і в `editionDetailResponseSchema`. Друга форма означала б, що сторінка твору
  показує переклади без рангу, а окремий запит — з рангом; UI довелося б робити
  другий запит рівно за тим самим, що вже приїхало.

---

## Питання до затвердження

**Q1. Чи заводити колонку `Translation.scoreBasis` (enum `WORK`/`GLOBAL`/`NEUTRAL`, nullable)?**
Ні §4.4, ні §10.2 її не вимагають; UI її не показує. За: перерахунок стає
аудитованим (видно, з чого рахували), і тест ідемпотентності 8h порівнює не лише
числа. Проти: CLAUDE.md — «no speculative abstractions», а гілку повертає й так
чиста функція 8b, тож тести 8b без колонки не страждають. **Рекомендація: не
заводити.** Гілка лишається значенням, яке повертає функція вибору C і яке 8b
перевіряє unit-тестом; колонку додамо, якщо 8h справді впреться.

**Q2. Чи додавати `updatedAt` до `TranslationRating`?**
§4.7 його не має. R2 робить POST upsert'ом, тобто оцінка редагується.
**Рекомендація: додавати** — інакше «поставив 3, потім виправив на 5» неможливо відрізнити
від «щойно поставив 5», а це те саме поле, за яким §4.7 уже розрізняє рецензії
(`Review.updatedAt`), і за яким мерж 7g обирає переможця. Відхилення записати
коментарем у схемі, як зроблено для `Author.nameNorm`.

**Q3. Як не залишати застарілі score після зміни глобального prior C?**
За R5 кожне створення, зміна або видалення TranslationRating може змінити
`GLOBAL` C. Перерахунок лише поточного Work тоді залишає stale score в інших
творах з однією Translation або без локальних оцінок. Перед 8b треба обрати одну
стратегію: стабільний materialized prior, перерахунок усіх залежних Work у тій
самій транзакції або іншу формулу, де локальна мутація не інвалідує всю базу.
**Блокує 8b і всі наступні підетапи.**

**Q4. Який єдиний порядок локів для rating/review mutation і merge?**
API має визначити канонічний Work, заблокувати його та повторно перевірити
Translation → Work **до** мутації. План мусить зафіксувати один порядок для
кількох Work і для merge, а також поведінку, коли Work змінився між початковим
читанням і локом. Сам лок усередині `recomputeWorkRatings()` після запису
недостатній: FK-запис уже може тримати `KEY SHARE` і створити lock-upgrade
deadlock. **Блокує 8b/8c/8d/8h.**

**Q5. Які viewer metadata повертає Review API?**
Сторінці 8f потрібні власна рецензія та причина недоступності форми. Звичайний
пагінований список не гарантує, що власний Review потрапив на поточну сторінку,
і не пояснює eligibility. **Рекомендація:** відповідь GET містить
`items`, `pagination`, `myReview`, `canReview` та стабільний
`reviewEligibilityReason`. **Блокує контракт 8a, API 8c та UI 8f.**

Поточна рекомендація для Q1 — не додавати `scoreBasis`; для Q2 — додати
`updatedAt`. Q3–Q5 не мають затвердженого рішення, тому наведені нижче DoD —
попередні й мають бути оновлені після вибору стратегії.

---

## Етап 8a — схема й контракти

Мета: модель даних і zod-контракти. Без бізнес-логіки й без ендпоінтів.

Дозволено чіпати: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/**`,
`packages/shared/**`, `apps/api/test/db/schema-objects.db-spec.ts`, `README.md`.

Definition of done:
- `TranslationRating` отримує `updatedAt` (Q2); решта полів уже є й не чіпається
- CHECK на рівні БД: `translation_rating_range` (`rating BETWEEN 1 AND 5`) і
  `review_rating_range` — обидва дописані руками, як `loan_borrower_not_owner`
- `Work.ratingAvg` / `ratingCount` і `Translation.ratingAvg` / `ratingCount` / `score`
  лишаються NOT NULL DEFAULT (R3); жодної зміни нульності
- контракти й zod-схеми в `packages/shared`: `contracts/review.ts` (Review, список
  із пагінацією та viewer metadata за Q5, create/update request),
  `contracts/rating.ts` (TranslationRating, upsert request)
- `REVIEW_NOT_ELIGIBLE`, `RATING_NOT_ELIGIBLE`, `REVIEW_EXISTS` у `errors.ts`
- міграція застосовується на чистій базі і на базі з даними; існуючі рядки
  проходять CHECK (перевірити, що seed не пише rating поза 1..5)
- `schema-objects.db-spec.ts` перевіряє наявність обох CHECK'ів
- `pnpm build` чистий для `packages/shared`

Не робити: ендпоінти, сервіси, UI, `scoreBasis` (див. Q1), розширення
`translationSchema` (воно атомарно переходить у нову форму в 8e).

## Етап 8b — сервіс перерахунку

Мета: серце етапу — чиста функція формули + сервіс, що її застосовує. Робиться до API,
бо інакше 8c і 8d реалізують перерахунок двічі по-різному.

Дозволено чіпати: `apps/api/src/ratings/**` (нова тека, unit-тести поруч із кодом —
`*.spec.ts`, як усюди в репозиторії; теки `test/unit/` не існує),
`apps/api/src/config/env.validation.ts`, `.env.example`, `README.md`.

Definition of done:
- чиста функція `computeScore({ R, v, m, C })` без залежностей від Prisma
- функція вибору C за каскадом R5, повертає `{ value, basis }`
- helper визначає канонічний Work, бере `FOR UPDATE` і повторно перевіряє
  Translation → Work **до мутації**; усі API та merge використовують той самий
  порядок локів (Q4)
- сервіс `recomputeWorkRatings(tx, workId)`: вимагає вже взятий лок (R6),
  перераховує `ratingAvg`/`ratingCount`/`score` усіх Translation цього Work і
  `Work.ratingAvg`/`ratingCount` з активних Review; приймає транзакцію ззовні,
  власної не відкриває
- обрана стратегія Q3 гарантує, що зміна GLOBAL C не лишає stale score в інших Work
- `RATING_PRIOR_M` у `env.validation.ts` (`z.coerce.number().int().positive().default(5)`)
  і в `.env.example`
- unit-тести без БД на матрицю: v = 0; v = 1; v = m − 1; v = m; велике v (≥ 100);
  одна Translation; кілька Translation; відсутність глобальних оцінок (гілка NEUTRAL)
- тест, що score монотонно зростає з R при фіксованому v і що при v → ∞ score → R
- тест, що при v = 0 score дорівнює рівно C

Не робити: ендпоінти, права, UI.

## Етап 8c — Review API

Дозволено чіпати: `apps/api/src/reviews/**`, `apps/api/src/app.module.ts`,
`packages/shared/**` (за потреби), `apps/api/test/**`.

Definition of done:
- `POST /api/v1/works/:id/reviews`, `PATCH /api/v1/reviews/:id`, `DELETE /api/v1/reviews/:id`
- `GET /api/v1/works/:id/reviews` із пагінацією; архівовані не віддаються (R1).
  Читання рецензій — доповнення до §8 (там перелічені лише три записи вище), без
  нього 8f не має що показувати. Відповідь містить viewer metadata за Q5:
  `myReview`, `canReview` і стабільний `reviewEligibilityReason`, незалежно
  від того, чи потрапив власний Review на поточну сторінку
- права за R7: власник Copy будь-якого Edition цього Work або RETURNED Loan
- повторний Review того самого користувача на той самий Work → 409 `REVIEW_EXISTS`
- запис на змержений Work → 409 `WORK_MERGED` (R8); читання — 301 (R8)
- створення/зміна/видалення і перерахунок `Work.ratingAvg`/`ratingCount` —
  одна транзакція; канонічний Work блокується і повторно перевіряється
  **до** мутації за Q4
- тест rollback: штучна помилка після запису Review лишає і рядок, і агрегати недоторканими
- тести авторизації: ownership дозволяє; RETURNED Loan дозволяє;
  REQUESTED / APPROVED / HANDED_OVER забороняють
- DTO-parity spec, як у `wishlist/dto/wishlist.dto.spec.ts`

Не робити: TranslationRating, UI.

## Етап 8d — TranslationRating API

**Ризик:** транзакція, порядок блокувань і конкурентність; див. Q3–Q4.

Дозволено чіпати: `apps/api/src/ratings/**`, `apps/api/src/app.module.ts`,
`packages/shared/**` (за потреби), `apps/api/test/**`.

Definition of done:
- `POST /api/v1/translations/:id/ratings` (upsert) і `DELETE .../ratings/me` за R2
- rating валідується як ціле 1..5 і в DTO, і в БД (CHECK з 8a)
- права за R7, але Copy/Loan має стосуватися Edition саме цього Translation;
  тест, де користувач має право на Work, але не на конкретний Translation → 403
- create / update / delete і перерахунок усіх Translation цього Work — одна
  транзакція; канонічний Work блокується й Translation → Work повторно
  перевіряється **до** мутації за R6/Q4
- online-мутація застосовує затверджену стратегію інвалідації GLOBAL C з Q3
- тест rollback: штучна помилка після запису оцінки не лишає розсинхрону між
  `TranslationRating` і колонками
- тест конкурентності: два паралельні POST різних користувачів на різні Translation
  одного Work — обидві оцінки збережені, агрегати збігаються з перерахунком з нуля.
  Контенція доводиться через `waitForBlockedBackend()` з `test/concurrency.helpers.ts`,
  а не через sleep
- тест конкурентності на один Translation: другий запит не втрачає першу оцінку

Не робити: читання ранжованого списку, UI.

## Етап 8e — ранжований список перекладів (API)

Дозволено чіпати: `apps/api/src/catalog/**`, `packages/shared/**`, `apps/api/test/**`.

Definition of done:
- `translationSchema` і всі catalog mapper/API-відповіді атомарно переходять
  на розширену форму за R11
- `GET /api/v1/works/:id/translations` і `GET /api/v1/works/:id` віддають сортування
  за R10 — ендпоінти вже існують, змінюється проєкція й тай-брейк
- кожен елемент несе: sourceLang, isAbridged, hasNotes, year, кількість видань,
  ratingCount, `rankReliable` (v ≥ m), власну оцінку користувача (`myRating`)
- при `rankReliable = false` числовий `score` у відповіді **`null`** — щоб UI
  фізично не міг його показати (R3)
- `createTranslation` блокує і повторно перевіряє Work до insert, а потім
  перераховує агрегати в тій самій транзакції (R3/Q4)
- запит зі старим workId поводиться за правилами 7h (301 + Location) — уже працює,
  покривається тестом на новій формі відповіді
- catalog e2e-перевірка відсутності `score` переписується під нову форму; номер
  рядка навмисно не фіксується
- тести: порядок при змішаних v; `score === null` при v < m; порожній Work;
  Work з однією Translation; `myRating` чужої людини не протікає

## Етап 8f — UI відгуків твору

Дозволено чіпати: `apps/web/**`.

Definition of done:
- список рецензій на сторінці Work, форма створення/редагування/видалення власної
- форма використовує viewer metadata з Q5: недоступна, якщо прав немає, і показує
  зрозуміле пояснення чому; власний Review не залежить від поточної сторінки списку
- обробка 403, 409 (`REVIEW_EXISTS`), 409 `WORK_MERGED`
- оптимістичне оновлення відкочується при помилці
- компонентні тести (`*.spec.tsx`, як `wishlist-button.spec.tsx`) на: створення,
  редагування, видалення, відмову за правами

## Етап 8g — UI оцінювання перекладу і ранжування

Дозволено чіпати: `apps/web/**`.

Definition of done:
- віджет оцінки 1..5 на Translation, стан «моя оцінка» видимий, зняття оцінки доступне
- ранжований список перекладів на сторінці Work (`TranslationCard` у
  `apps/web/app/works/[id]/page.tsx` уже показує ознаки §10.3 — додається ранг)
- cold start: при `rankReliable = false` числового рангу немає взагалі — показуються
  sourceLang, isAbridged, hasNotes, year, кількість видань і кількість оцінок
- 5.0 від одного користувача не подається як надійний ранг у жодному вигляді
- тести: список із надійними і ненадійними рангами, встановлення оцінки, зняття оцінки

## Етап 8h — recompute CLI і закриття §10.2

**Крос-катінг:** чіпає merge з 7g; порядок блокувань має лишатися узгодженим із R6/Q4.

Дозволено чіпати: `apps/api/src/cli/**`, `apps/api/src/catalog/merge/**`,
`apps/api/src/ratings/**`, `apps/api/package.json` (скрипт, як `merge:works`),
`apps/api/test/**`, `README.md`.

Definition of done:
- admin CLI `ratings:recompute [--work-id]` перераховує агрегати з нуля; без аргументу —
  по всіх Work, батчами, з прогресом (структура — за `cli/merge-works.ts` і
  `cli/merge-cli.module.ts`)
- merge Work (7g) викликає перерахунок цільового Work у тій самій транзакції —
  закриває борг §10.2. `MergeService.TransactionClient` розширюється на
  `translationRating`
- перерахунок ідемпотентний: два послідовні прогони дають однаковий результат
- тест: після merge двох Work з рецензіями й оцінками агрегати цільового Work
  збігаються з перерахунком з нуля, а архівовані рецензії (R1) в них не входять
- README: як і коли запускати recompute після зміни `RATING_PRIOR_M`

---

## Свідомо винесено з етапу 8

- модерація і скарги на рецензії
- текстовий пошук за вмістом рецензій
- сповіщення про нову рецензію (потребує рішення про тип події в підсистемі етапу 6)
- об'єднання WorkAuthor при мержі — борг етапу 7, не закривається тут
- дедуплікація однакових Translation після мержу — борг етапу 7
- кешування ранжованого списку
- `Translation.scoreBasis` — див. Q1; заводиться лише якщо 8h впреться
