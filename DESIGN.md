# DESIGN.md — Дизайн-система проекта Finans

> Этот файл — **единственный источник правды** по визуальному стилю.
> Любая новая вьюха, компонент или правка CSS должны сверяться с ним.
> Обновлять — при добавлении новых токенов/компонентов (см. README-AI.md).

---

## 1. Философия стиля

Плотная, но дышащая сетка; **один акцент — teal `#1abb9c`**; тёмный сайдбар;
почти невидимые тени (объём даёт рамка); небольшие радиусы 4/6/8; таблицы как
основной носитель информации; пастельные «бейджи» для типов; ноль шумных анимаций.

**Визуальный ориентир — Gentelella v4** (Colorlib). Это явный референс, а не
«похожий стиль». Все токены сверены 1:1 с `src/scss/v4/_tokens.scss` из
npm-пакета `gentelella@4.0.1`.

- **Live demo:** https://preview.colorlib.com/theme/gentelella/
- **Исходники:** https://github.com/ColorlibHQ/gentelella
- **Токены:** https://cdn.jsdelivr.net/npm/gentelella@4.0.1/src/scss/v4/_tokens.scss
- **Стек референса:** vanilla JS + SCSS + Vite 8. **Без Bootstrap, без jQuery** — наш стек совпадает.

### 1.1. Ключевые принципы Gentelella v4 (что мы наследуем)

1. **Один CSS-файл, одни токены.** Цвета/тени/радиусы — через `var(--…)`. Хардкод — только как исключение (`:root`).
2. **Контент первичен.** Карточки не дышат — `gap 16px`, `padding 16px`. Таблицы — максимум строк во вьюпорте.
3. **Иерархия без украшательства.** Primary = teal, Danger = красный outline, Ghost = `var(--surface)` с бордером. Не изобретай новых вариантов кнопок.
4. **Локализация.** Тексты — по-русски. Числа — `ru-RU` (`1 500,50 ₽`). Десятичный разделитель в полях — запятая.
5. **Иконки — FA 4.** Никаких SVG-спрайтов, эмодзи только в `categoryIcons.js`.

### 1.2. Что уже соответствует Gentelella v4

| Узел            | Статус | Где в проекте                                  |
|-----------------|--------|------------------------------------------------|
| Sidebar + rail  | ✅     | `.sidebar` (тёмный `#1a2332`), `.sidebar-hidden` |
| Topbar          | ✅     | `.topbar` (56px, blur) + `.sidebar-toggle`     |
| Cards (стат.)   | ✅     | `.card`, `.cards` (5 колонок)                  |
| Tables          | ✅     | `.table`, `.table-wrap`, sticky thead          |
| Modal + backdrop| ✅     | `.modal`, `.modal-backdrop` (openModal)        |
| Toast           | ✅     | `#toast`, `.toast.error`/`.success` (левая полоса) |
| Badges          | ✅     | `.badge`, `.badge-info`/`.warn`/etc.            |
| Filters-bar     | ✅     | `.filters-bar`, `.filters-bar--inline`         |
| Brand mark      | ✅     | `.brand`, `.brand-dot` (teal-квадрат)          |
| Формы           | ✅     | `.form-field`, высота 36, radius 4, teal-ring  |
| Токены референса| ✅     | `:root` в `styles.css` (палитра, space, radius) |
| Dark mode       | 🟡     | токены `[data-theme="dark"]` заложены, переключателя нет |
| Tabs            | ❌     | только частный `.icon-picker-tabs`             |
| Breadcrumbs     | ❌     | отсутствуют                                    |
| DataTables      | ❌     | обычная таблица без sort/paginate              |
| ⌘K palette      | ❌     | отсутствует                                    |
| Charts          | ❌     | нет (только стат-карточки)                     |
| Pagination      | ❌     | `limit=500`, без пагинации                     |
| Theme generator | ❌     | цвета в `:root`, без live-настройки            |

Полный чек-лист фич референса — в README.md ColorlibHQ/gentelella. Перед стартом
большой задачи — сверяйся с `playground.html` демо (живые примеры компонентов).

### 1.3. Сознательные отступления от референса

| Что | В референсе | У нас | Почему |
|-----|-------------|-------|--------|
| Акцент | teal `#1abb9c` для всего | `--primary #1abb9c` только для декора + `--primary-strong #0e7a68` для текста/фокуса | яркий teal даёт 2.43:1 — ниже AA и ниже 3:1 для индикаторов фокуса (WCAG 1.4.11) |
| Текст и семантика | `--text-muted #7e8896`, `--green #2fb344`, `--red #d63939` | `--text-secondary #626d7d`, `#178030`, `#b02c2c` | те же причины: 3.59 / 2.74 / 4.66 — ниже AA |
| Кнопка Danger | сплошная красная `.btn-danger` | красный outline | в реестре операций сплошные красные кнопки в каждой строке слишком агрессивны |
| Текст ячеек таблицы | `--text-secondary` | `--text` | finans — реестр; приглушение всех колонок бьёт по читаемости |
| Бейджи | прямоугольные, radius 3px | radius 4px (`--radius-sm`) | сохранена плотность и uppercase-семантика статусов |
| Навигационные ссылки | `a:hover { underline }` глобально | только `.cards-badge` | подчёркивание на hover ломало бы `.card-link` и `.nav a` |
| `.nav-section` | `rgba(123,143,163,0.5)` | `--sidebar-text` — как у пунктов меню | 0.5 давала 2.26:1. Цвет меню — 4.74:1 (AA); иерархия держится размером 10px, uppercase и letter-spacing, а не цветом |
| `--primary-dk` | `#169f85` в палитре | токен удалён | после введения `--primary-strong-dk` остался без единого использования |
| Селекты | свой SVG-шеврон (`appearance: none`) | нативная стрелка | меньше хардкода в CSS, поведение платформы предсказуемо |
| Шрифт | Inter с Google Fonts | `'Inter'` первым в `var(--font)` с system-fallback | без внешних запросов и новых зависимостей |

> Замеры контраста по каждому элементу — §2.9. Токены — §2.1.

---


## 2. Токены (CSS-переменные в `:root`)

> Значения — 1:1 с `gentelella@4.0.1/src/scss/v4/_tokens.scss`.

### 2.1. Цвета

**Бренд и акцент**

| Токен                 | Значение                | Назначение                                              |
|-----------------------|-------------------------|---------------------------------------------------------|
| `--primary`           | `#1abb9c`               | Бренд-цвет **для декора**: `.brand-dot`, тинты, hover-границы |
| `--primary-strong`    | `#0e7a68`               | Тот же оттенок **для текста, заливок под белым текстом и индикаторов фокуса** |
| `--primary-strong-dk` | `#0b6355`               | Hover `--primary-strong` (фон `.btn-primary:hover`)     |
| `--primary-lt`        | `rgba(26,187,156,0.08)` | Заливка hover/selected                                  |
| `--primary-ring`      | `rgba(26,187,156,0.18)` | Внешнее свечение вокруг выбранного свотча               |

> **Зачем два teal.** `#1abb9c` на белом даёт 2.43:1 — ниже AA (4.5:1) для текста
> и ниже 3:1, которое WCAG 1.4.11 требует для индикаторов фокуса. Поскольку цвет
> один и тот же, «плохими» были бы все места сразу: ссылки, primary-кнопки,
> активные таб/тумблеры, опции дропдаунов, фокус-рамки. Поэтому заведён
> `--primary-strong` — тот же тон, глубже (5.25:1). Яркий `--primary` оставлен
> там, где контраст с текстом не нужен: `.brand-dot`, hover-границы
> (`.card-link:hover`, `.category-select-trigger:hover`), тинты `-lt`.
> `--accent` и `--accent-hover` (алиасы) указывают на **strong**-пару — так все
> существующие `var(--accent)` во вьюхах и CSS сразу стали доступными.

**Семантическая палитра**

| Токен      | Значение   | Токен     | Значение   | Токен    | Значение   |
|------------|------------|-----------|------------|----------|------------|
| `--blue`   | `#066fd1`  | `--green` | `#2fb344`  | `--yellow` | `#f59f00` |
| `--azure`  | `#4299e1`  | `--red`   | `#d63939`  | `--orange` | `#f76707` |
| `--purple` | `#ae3ec9`  | `--pink`  | `#d6336c`  | `--lime`   | `#74b816` |
| `--indigo` | `#4263eb`  | `--cyan`  | `#17a2b8`  |            |           |

Плюс прозрачные производные: `--green-lt`, `--red-lt`, `--red-ring`, `--yellow-lt`,
`--blue-lt`, `--azure-lt`, `--purple-lt`, `--slate-lt` (все ~0.08 alpha).

**Поверхности, текст, границы**

| Токен                    | Значение           | Назначение                                  |
|--------------------------|--------------------|---------------------------------------------|
| `--body-bg`              | `#f5f7fb`          | Фон страницы (внешний «воздух»)             |
| `--bg-surface`           | `#ffffff`          | Поверхности: карточки, топбар, таблицы      |
| `--bg-surface-secondary` | `#f9fafb`          | Шапка таблицы, hover строки, вторичные блоки |
| `--border-color`         | `#e6e7eb`          | Границы инпутов, карточек, разделители      |
| `--border-color-light`   | `#eff0f3`          | Тонкие разделители строк таблиц             |
| `--border-translucent`   | `rgba(4,32,69,0.08)` | Контур в `--shadow-card`/`--shadow-pop`   |
| `--text`                 | `#1e2633`          | Основной текст                              |
| `--text-secondary`       | `#626d7d`          | Второстепенный текст, ghost-кнопки          |
| `--text-muted`           | `#7e8896`          | Подписи, мета, плейсхолдеры                 |
| `--text-disabled`        | `#c0c7cf`          | Плейсхолдеры, disabled                      |
| `--hover`                | `rgba(0,0,0,0.04)` | Мягкая hover-заливка на светлом             |
| `--hover-soft`           | `rgba(0,0,0,0.02)` | Ещё мягче (фон заголовка дерева)            |

**Sidebar (тёмный)**

| Токен                  | Значение                | Назначение                     |
|------------------------|-------------------------|--------------------------------|
| `--sidebar-bg`         | `#1a2332`               | Фон панели                     |
| `--sidebar-text`       | `#7b8fa3`               | Обычный пункт                  |
| `--sidebar-text-hover` | `#c5d0dc`               | Hover пункта                   |
| `--sidebar-text-active`| `#ffffff`               | Активный пункт, имя бренда     |
| `--sidebar-hover`      | `rgba(255,255,255,0.04)`| Hover-заливка                  |
| `--sidebar-active`     | `rgba(26,187,156,0.10)` | Заливка активного пункта       |
| `--sidebar-border`     | `rgba(255,255,255,0.06)`| Разделитель под брендом        |
| `--sidebar-w`          | `252px`                 | Ширина колонки `.app`          |

> **Алиасы** (исторические имена проекта — все вьюхи и часть CSS ссылаются на них;
> `--bg`, `--surface`, `--border`, `--accent`, `--accent-hover`, `--warning`
> определены как `var(...)` и потому автоматически следуют за `[data-theme="dark"]`):
> `--bg`→`--body-bg`, `--surface`→`--bg-surface`, `--border`→`--border-color`,
> `--accent`→`--primary-strong`, `--accent-hover`→`--primary-strong-dk`,
> `--warning`→`--yellow`.
>
> **Текстовые варианты (не алиасы, а литералы).** `--muted`, `--success`, `--danger` —
> семантические цвета проекта, и для текста они намеренно **темнее** одноимённых
> «филловых» цветов референса (иначе ниже WCAG AA — см. §2.9):
> `--muted` = `--text-secondary` (#626d7d), `--success` = `#178030`, `--danger` = `#b02c2c`.
> `--green`/`--red`/`--text-muted` остаются в палитре как филловые цвета и в тёмной
> теме возвращаются в алиасы (на тёмном фоне нужны светлые значения).

### 2.1.1. Тёмная тема

Значения заложены в `[data-theme="dark"]` (переключателя пока нет — включается
атрибутом на `<html>`). Переопределяются поверхности/текст/границы, прозрачные
`-lt` (плотнее, alpha 0.14–0.18) и **текстовые варианты** `--muted`/`--success`/`--danger`:
они возвращаются к светлым значениям референса (`--text-muted`, `--green`, `--red`),
потому что затемнённые варианты из §2.9 на тёмном фоне дают 2.9:1.
Алиасы и `--primary` не дублируются.

### 2.2. Состояния (hover/active/focus/disabled)

| Контекст           | Правило                                                              |
|--------------------|----------------------------------------------------------------------|
| Hover на `.btn`    | `background: var(--bg-surface-secondary); color: var(--text)`        |
| Hover на `.btn-primary` | `background: var(--accent-hover)` (`--primary-strong-dk`)        |
| Hover на `.nav a`  | `background: var(--sidebar-hover); color: var(--sidebar-text-hover)` |
| Active (`.active`) | `background: var(--primary-lt); color: var(--accent)` (= `--primary-strong`); в сайдбаре — `--sidebar-active` |
| Focus ring         | Глобально `:focus-visible { outline: 2px solid var(--primary-strong); outline-offset: 2px }`; у полей ввода — `border-color: var(--primary-strong) + box-shadow: 0 0 0 3px var(--primary-lt)` |
| Disabled `.btn:disabled` | `opacity: 0.5; cursor: not-allowed`                              |

> Индикаторы фокуса — всегда `--primary-strong`, никогда яркий `--primary`:
> WCAG 1.4.11 требует 3:1 для нетекстовых индикаторов, а яркий teal даёт 2.43:1.

### 2.3. Типографика

- **Семейство:** `var(--font)` = `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
  (Inter подключается не внешним запросом, а берётся из системы, если установлен).
- **Базовый размер:** `14px` (`html, body { font-size: 14px; line-height: 1.4286; }`).
- **Шкала размеров:** `10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 14 / 15 / 18 / 22 px`.
- **Веса:** `400` (обычный текст, пункты навигации), `500` (UI-элементы, active), `600` (заголовки/бейджи/карточные значения).
- **Monospace:** `var(--font-mono)` — для PAN-масок, hex-кодов, тикеров.
- **Uppercase + tracking:** для подписей (`text-transform: uppercase; letter-spacing: 0.3–0.5px`).

### 2.4. Отступы (spacing scale)

Переменные `--space-1..8` = 4/8/12/16/24/32/48/64 px (4px база, как в референсе).
Применяются: `--space-1` — микро-гэпы; `--space-2` — паддинг сайдбара, gap `.card-sub`;
`--space-3` — паддинг пунктов меню; `--space-4` — `.card`, gap `.cards`;
`--space-5` — `.view`, `.topbar`, отступ под блоками.
Плюс устоявшиеся межпиксельные значения 2/5/6/10/14 — для иконок и компактных строк.

### 2.5. Радиусы

| Токен / класс                 | Значение | Где                                                 |
|-------------------------------|----------|-----------------------------------------------------|
| `--radius`                    | `6px`    | Дропдауны, `.filters-bar`, `.empty-inline`           |
| `--radius-sm`                 | `4px`    | Кнопки, поля ввода, бейджи, `.dashboard-card`        |
| `--radius-lg`                 | `8px`    | Карточки, `.table-wrap`, `.modal`, `.tree-wrap`      |
| `.brand-dot`                  | `6px`    | Марка бренда (teal-квадрат 28×28)                    |
| `.badge`, `.cat-type`         | `4px`    | Прямоугольные бейджи (были таблетки 999px)           |

### 2.6. Тени

| Токен              | Значение                                              | Назначение                     |
|--------------------|-------------------------------------------------------|--------------------------------|
| `--shadow`         | `rgba(30,38,51,0.04) 0 2px 4px 0`                     | Карточки, ghost-кнопки, поля   |
| `--shadow-card`    | `0 0 0 1px var(--border-translucent), rgba(30,38,51,0.04) 0 2px 4px 0` | `.card-link:hover` |
| `--shadow-pop`     | `0 8px 24px rgba(15,23,42,0.12), 0 0 0 1px var(--border-translucent)` | дропдауны, `.toast` |
| `--shadow-modal`   | `0 24px 48px rgba(15,23,42,0.18), 0 0 0 1px var(--border-translucent)` | `.modal` |

### 2.7. Z-index

| Слой                 | z-index | Примеры                                  |
|----------------------|---------|------------------------------------------|
| Контент              | `auto`  | Карточки, таблицы                        |
| Sticky thead         | `1`     | `.table th`                              |
| Dropdown-меню        | `50`    | `.category-select-dropdown`, `.import-menu-dropdown`, `.inline-pick-popover` |
| Toast                | `100`   | `#toast`                                 |
| Modal backdrop       | `200`   | `.modal-backdrop`                        |

### 2.8. Брейкпоинты (responsive)

| Ширина        | Что меняется                                                       |
|---------------|--------------------------------------------------------------------|
| ≤ 1280px      | `.cards` → 3 колонки вместо 5                                      |
| ≤ 768px       | `.app` → одна колонка; сайдбар `display: none`; `.topbar` padding `0 16px`; `.view` padding 16px |
| ≤ 480px       | `.cards` → 1 колонка                                                |

> Мобильная ветка использует `grid-template-columns: minmax(0, 1fr)`, **не** `1fr`.
> `1fr` = `minmax(auto, 1fr)`, трек не сжимается ниже `min-content` широкого ребёнка
> (таблица, дерево портфеля), и вместе с `body { overflow-x: hidden }` правый край
> контента срезался без возможности доскроллить. Замерено: на 768px обрезалось
> до 752px (портфель), на 390px — до 1130px на 8 страницах; с `minmax(0, 1fr)` — 0.

### 2.9. Контраст (замерено в живом приложении, WCAG AA = 4.5:1)

Замеры Playwright/chromium 1440×900, с учётом эффективного фона (прозрачные слои
складываются с родителем). Все значения — **после** контрастных правок.

| Элемент | Отношение | AA |
|---------|-----------|----|
| `.card-value` (обычные), `.table td`, `.topbar h1` | 15.2 | ✅ |
| `.brand` (белый на тёмном сайдбаре) | 15.8 | ✅ |
| `.nav a.active` | 13.4 | ✅ |
| `.num.num-expense`, `.card.danger .card-value` | 6.5 | ✅ |
| `.badge-expense`, `.btn-danger` | 5.8 | ✅ |
| `.btn` (ghost), `.btn-primary`, `.cards-badge`, `.toggle-label` (checked) | 5.25 | ✅ |
| `.card.accent .card-value` (strong-teal на белом) | 5.25 | ✅ |
| `.card-label`, `.card-sub` | 5.25 | ✅ |
| `.topbar-meta` | 5.2 | ✅ |
| `.card.success .card-value` | 5.04 | ✅ |
| `.table th` | 5.02 | ✅ |
| обычная ссылка `a` | 4.89 | ✅ |
| `.nav a` (неактивный) | 4.74 | ✅ |
| `.badge-income` | 4.67 | ✅ |
| `.nav-section` (разделитель секции) | 4.74 | ✅ |

**Ниже AA не осталось ничего.** `.nav-section` в референсе имеет alpha 0.5 (2.26:1),
промежуточный вариант 0.7 давал 3.06:1 — тоже ниже AA. Остановились на цвете пунктов
меню (`--sidebar-text`, 4.74:1): иерархия раздела сохранена размером 10px против 13px,
uppercase и letter-spacing, поэтому цвет можно не приглушать.

**Что правилось (два независимых дефекта):**

| Токен | Было (референс) | Стало | Было → стало |
|-------|-----------------|-------|--------------|
| `--muted` | `#7e8896` | `--text-secondary` `#626d7d` | 3.59 → **5.25** |
| `--success` | `#2fb344` | `#178030` | 2.74 → **5.04** |
| `--danger` | `#d63939` | `#b02c2c` | 4.66 → **6.48** |
| teal для текста/фокуса | `--primary` `#1abb9c` | `--primary-strong` `#0e7a68` | 2.43 → **5.25** |
| `.nav-section` | `rgba(123,143,163,0.5)` | `--sidebar-text` `#7b8fa3` | 2.26 → **4.74** |

Побочно подтянулись `.badge-expense` (4.16 → 5.78), `.badge-income` (2.50 → 4.67),
`.table th` (3.44 → 5.02). В тёмной теме `--muted`/`--success`/`--danger`
возвращаются к светлым значениям референса — на тёмном фоне затемнённые нечитаемы
(см. §2.1.1); `--primary-strong` не переопределяется, он и на тёмном фоне даёт
достаточный контраст с белым текстом.

---

## 3. Компоненты

Для каждого: **назначение**, **классы**, **HTML-скелет**, **do/don't**.

### 3.1. Layout shell

`.app` (grid `var(--sidebar-w)` / 1fr, height 100vh) → `.sidebar#sidebar` + `.content` (`.topbar` + `.view#view`).
Всё смонтировано в `ui/index.html`, вьюхи только пишут в `#view`.
`.app.sidebar-hidden` → первая колонка `0` (плавное сворачивание, состояние в `localStorage.sidebar.hidden`).
`.topbar` — height 56px, полупрозрачный фон + `backdrop-filter: blur(12px)`; `.nav` внутри сайдбара скроллится сам (`overflow-y: auto`), бренд зафиксирован.

**Скролл-модель (важно).** Страница (`body`) не скроллится **никогда** — иначе
`position: static` сайдбар и топбар уезжали бы вверх. Скроллеры — внутренние:

| Что | Скроллится | Когда |
|-----|-----------|-------|
| `.table-wrap` | да (`flex: 1 1 auto; overflow: auto`) | таблица длиннее вьюпорта; работает, только если `.table-wrap` — **прямой flex-ребёнок** `.view` (поэтому у секций `display: contents` — см. `.table-section`) |
| `.view` | да (`overflow-y: auto`) | содержимое страницы не помещается целиком (форма + список, как на `/import-rules`) |
| `.nav` | да | пунктов меню больше, чем высоты сайдбара |
| `body` | **нет** | — |

⚠️ Не добавляй на страницы контейнеры, которые растят содержимое мимо `.view`:
если контент вылезет за `100vh`, скроллером станет `body` (у него `overflow-x: hidden`,
из-за чего `overflow-y` вычисляется в `auto`) — и сайдбар поедет вверх вместе со
страницей. Именно это происходило на `/import-rules` до правки: форма + 28 правил
давали 1912px при вьюпорте 900, и колесо над контентом сдвигало сайдбар на -1012px.
Проверять надо `document.body.scrollHeight` — `documentElement` при этом остаётся
равен вьюпорту, а `window.scrollTo` ничего не двигает.

### 3.2. Сайдбар

Тёмный (`--sidebar-bg`), ширина `--sidebar-w` (252px). Пункт: min-height 32px, radius 4px, иконка 18px с `opacity: 0.5` (0.85 на hover/active).

| Класс           | Назначение                                                       |
|-----------------|------------------------------------------------------------------|
| `.brand`        | Логотип-ссылка (`.brand-dot` + «Finans»), height 56px, белый текст |
| `.nav`          | Контейнер пунктов (скроллится)                                   |
| `.nav-section`  | Заголовок секции (10px, uppercase, `--sidebar-text` — как у пунктов меню) |
| `.nav a`        | Пункт меню (`.active` — `--sidebar-active` + белый текст)        |
| `.nav-icon`     | FA-иконка                                                        |

```html
<a href="#/transactions" class="active">
  <i class="fa fa-exchange nav-icon"></i>Операции
</a>
```

### 3.3. Кнопки `.btn`

Все кнопки — height 32px (`--btn-sm` 28px), padding `0 12px`, radius 4px, кегль 12.5px, `justify-content: center`.

| Класс               | Назначение                                           |
|---------------------|------------------------------------------------------|
| `.btn`              | Ghost: белый фон, бордер, `hover: var(--bg-surface-secondary)` |
| `.btn-primary`      | Teal-фон, белый текст (главное действие)             |
| `.btn-danger`       | Красный outline (удаление)                           |
| `.btn-sm`           | Маленькая (в строке таблицы, фильтр-баре)            |

**Do:** иконка слева (`<i class="fa fa-…">`), затем текст.
**Don't:** не изобретай `.btn-success` / `.btn-warning` / `.btn-outline-*` — для цвета используй класс-маркер на родителе (`.card.success`).

### 3.4. Карточки `.card`

```html
<div class="card">
  <div class="card-label">Подпись</div>
  <div class="card-value">1 500,00 ₽</div>
  <div class="card-sub">пояснение</div>
</div>
```

Цвет значения: `.card.accent` / `.card.success` / `.card.danger`.
Кликабельная: `<a class="card card-link" href="…">`. Сетка `.cards` — 5 колонок (брейкпоинты §2.8).

### 3.5. Таблицы `.table` / `.table-wrap`

```html
<div class="table-wrap">
  <table class="table">
    <thead><tr><th>Дата</th><th class="num">Сумма</th></tr></thead>
    <tbody><tr><td>01.09.2026</td><td class="num">1 500,00 ₽</td></tr></tbody>
  </table>
</div>
```

- `.num` — числовые колонки (`tabular-nums`, правый край).
- Базовые ячейки — `padding: 8px 16px`, `vertical-align: middle`, разделитель `--border-color-light`;
  `th` — 11px uppercase, `letter-spacing: 0.3px`, фон `--bg-surface-secondary` (sticky).
- `.table-import` — компактная для превью импорта (padding 6×8, шрифт 12px).
- `.table-compact` — для настроек (padding 5×10).
- `.table-total-row` — итоговая строка («Итого»): `font-weight: 600`, фон `--hover-soft`.
- `.row-actions` — кнопки действий в строке (горизонтально справа).
- `.comment-input` — инпут inline-правки комментария (по `dblclick` по `.comment-cell`);
  плотный (padding 2×6, radius 4), со своим `:focus` через `--primary-strong`.
- `.tx-row` — кликабельная строка (дашборд).
- Цвета сумм: `.num.num-expense` → `--danger`, `.num.num-income` → `--success`,
  `.profit-pos` → `--success`, `.profit-neg`/`.amt-neg` → `--danger`.
- Текст ячеек — `--text` (отступление от референса, см. §1.3).
- Пусто — `.empty` внутри `.table-wrap` вместо `<table>`.

### 3.6. Бейджи `.badge`

`.badge-expense` / `.badge-income` / `.badge-info` / `.badge-warn` / `.badge-ok` / `.badge-error`.
Прямоугольные (radius 4px), 10.5px uppercase, `letter-spacing: 0.3px`, палитра `--*-lt` фон + насыщенный цвет.
Для типа категории: `.cat-type.cat-type-expense` / `.cat-type.cat-type-income`.

### 3.7. Модалка

В коде — **только через `openModal`** из `ui/js/ui/modal.js`. Не создавай модалки вручную.

**Две формы вызова** (все опции второй — опциональны, первая работает как раньше):

```js
// 1. Форма из декларативных полей — обычный случай.
openModal({ title, fields, submitLabel, onSubmit, onMount })

// 2. Своя разметка тела — когда нужен динамический список или собственная форма.
openModal({ title, body, closeLabel, wide, onMount, onClose })
```

| Опция | Назначение |
|-------|-----------|
| `body(host, dialog, close)` | Заменяет блок полей. Контейнер становится `div`, а не `form`: вьюха приносит собственную форму, а вложенные `<form>` браузер не поддерживает. Кнопки submit в этом режиме нет |
| `closeLabel` | Подпись кнопки закрытия в режиме `body` (по умолчанию «Отмена») |
| `wide` | Класс `.modal-wide` — 520px вместо 480 |
| `onClose` | Вызывается после закрытия **любым** путём (backdrop, Esc, кнопка) — чтобы вьюха перерисовалась |
| `onMount(dialog, close)` | Общий хук после монтирования; `close` добавлен вторым аргументом |

```html
<div class="modal-backdrop">
  <div class="modal" role="dialog" aria-modal="true">
    <h2 class="modal-title">…</h2>
    <form class="modal-form">
      <div class="form-field"><label>…</label><input></div>
      <div class="modal-actions">
        <button class="btn" data-action="cancel">Отмена</button>
        <button class="btn btn-primary" type="submit">Сохранить</button>
      </div>
    </form>
  </div>
</div>
```

В режиме `body` вместо `<form class="modal-form">` идёт `<div class="modal-form" data-modal-body>`,
а `.modal-actions` выносится **наружу** — иначе перерисовка тела затирала бы кнопки.
Пример — модалка «Карты счёта» (`accounts.js`): динамический список + своя форма добавления.

`.form-field` — вертикальный layout. `.form-grid` — двухколоночная сетка
(`repeat(2, minmax(0, 1fr))`, при ≤640px — одна колонка); `.form-row` — inline.
В `.form-grid` клади именно `.form-field`: нижний отступ снимается, расстояние даёт `gap`,
а подпись-`<span>` получает вид `.form-field label`. Если `.form-field` сам является
`<label>` (обёртка вокруг контрола) — это нормально, селекторы контролов достают и туда.
Поля `.form-field input/select/textarea` — height 36px, radius 4px, focus `border-color: var(--primary-strong)` + `box-shadow: 0 0 0 3px var(--primary-lt)`; `textarea` — height auto, min 90px.
`.modal` — radius 8px, padding 18px, `--shadow-modal`; заголовок 15px/600.
Типы полей в `openModal`: `select`, `textarea`, `checkbox`, `toggle`, `color`, `category-select`, `combobox` (полный список — `modal.js`).

**Специфичные для одной вьюхи классы модалок** (не переиспользуй как общие):

| Класс | Назначение |
|-------|-----------|
| `.modal-wide` | 520px — модалке карт нужно две колонки полей |
| `.cards-manager-list` | Список карт в модалке карт |
| `.cards-manager-row` | Строка карты: flex, `var(--radius)`, рамка |
| `.cards-manager-label` | Мелкая метка карты (12px, muted) |
| `.cards-manager-empty` | «Карты ещё не привязаны» |
| `.cards-add-form` | Форма-строка добавления карты (border-top сверху) |
| `.cards-note` | Пояснение внизу (12px, muted) |
| `.card-pan` | Маска карты: `var(--font-mono)`, 14px |

### 3.8. Фильтры и тулбар

| Класс                    | Назначение                                                |
|--------------------------|-----------------------------------------------------------|
| `.filters-bar`           | Карточка-строка фильтров над таблицей                     |
| `.filters-bar--inline`   | Inline внутри `.page-toolbar` (без рамки)                 |
| `.filter`                | Контейнер одной группы **внутри фильтр-бара** (label + input) |
| `.page-toolbar`          | `[фильтры / итоги] + [actions справа]`                    |
| `.page-toolbar--filters` | Без прижатия actions к правому краю (для transactions)    |
| `.page-summary`          | Сводка слева в тулбаре (`Итого`, «Активных N»…)           |
| `.page-actions`          | Кнопки справа                                             |
| `.page-header`           | `h2 + actions` (без тулбара)                              |
| `.view-mode-toggle`      | Сегментированный переключатель режимов                    |

> ⚠️ **`.filter` работает только внутри фильтр-бара.** Его стили заданы как
> `.filters-bar .filter` и `.filters-bar--inline .filter` — вне них класс не даёт
> ничего. В форме используй `.form-field` (см. §3.7), иначе получишь нативные
> контролы: `border 1px #767676`, `radius 0`, высоту 19–21px, шрифт 13.33px и
> ширину по содержимому — в одинаковых колонках это давало 49 / 108 / 144 / 153 / 191px.</

### 3.9. Переключатели

Два варианта: `.toggle-group` (внутри формы, поле `type: 'toggle'`) и `.view-mode-toggle` (виджет).

```html
<div class="toggle-group">
  <input type="radio" class="toggle-segment" name="x-seg" id="x-0" checked>
  <label for="x-0" class="toggle-label">Вар. 1</label>
  <input type="radio" class="toggle-segment" name="x-seg" id="x-1">
  <label for="x-1" class="toggle-label">Вар. 2</label>
</div>
```

### 3.10. Кастомные dropdown'ы

`.category-select` (с FA-иконками), `.combobox` (поиск+выбор), `.import-menu` (кнопка+меню).
Все: `position: absolute; z-index: 50`, закрытие по клику вне / Escape.

Отдельный случай — `.inline-pick` + `.inline-pick-popover` (превью импорта выписки):
кнопка в ячейке таблицы открывает всплывающий список с поиском по подстроке.
Один компонент на счёт и на категорию (`data-field`), у перевода — две кнопки
(источник/получатель).
Панель кладётся в `document.body` с `position: fixed` (позиция считается в JS от
кнопки) — иначе её обрезал бы `overflow: auto` у `.table-wrap`. Закрытие: клик вне,
Escape, повторный клик по кнопке, скролл/resize/смена hash.
Список и поиск — те же классы `.category-select-*`, что в модалке.

### 3.11. Pickers

Используются только через `openModal` (поля `type: 'category-select'` / `'color'`). Не строй свои.

### 3.12. Состояния

| Класс          | Назначение                                          |
|----------------|-----------------------------------------------------|
| `.loading`     | Текст «Загрузка…» в `#view` до получения данных    |
| `.empty`       | Пусто (карточка с пояснением и CTA)                 |
| `.empty-actions`| Обёртка CTA внутри `.empty` (`margin-top: 16px`)  |
| `.empty-inline`| Inline для секции настроек (без тени)               |
| `.empty-title` | Заголовок внутри `.empty`                           |
| `.form-error`  | Ошибка внутри формы модалки                         |
| `#toast`       | `toast(msg, kind)` из `api.js`; 2.4с; kind: `''`/`success`/`error` |

### 3.13. Дерево портфеля `.tree-wrap`

Специфичный компонент для портфеля (`simple-list.js`). Не переиспользуй для других задач.

### 3.14. Mini-dashboard `.dashboard-section` / `.dashboard-card`

Компактные карточки групп портфеля. Сетка `.dashboard-cards { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }`.

### 3.15. Подписи и служебные

`.section-title` (заголовок секции), `.section-title-row` (заголовок+actions справа),
`.page-title` (`h2` без тулбара), `.hint-warn` (мутон-подсказка под полем),
`.muted-inline` (мелкий muted у заголовка), `.save-rule` (чекбокс «сохранить правило»).

Плюс из пятого прохода (замена одиночных inline-цветов):

| Класс | Назначение |
|-------|-----------|
| `.muted` | `color: var(--muted)`. До этого существовал только в составных селекторах — как самостоятельный класс не давал ничего |
| `.acc-color-dot` | Маркер цвета счёта в таблице (10px круг); сам цвет — из данных через `cssColor()` |
| `.card-manager-row` | Строка карты в модалке «Карты счёта» (`accounts.js`): flex-раскладка + `var(--radius)` |
| `.card-pan` | Маска карты: `var(--font-mono)`, 14px |

---

## 4. Правила использования

1. **Всегда токены, не хардкод.** `var(--primary)`/`var(--accent)`, не `#1abb9c` (исключения — `:root` и §2.1).
2. **Переиспользуй существующие классы.** Новый — только если подходящего нет, в конец `styles.css` с комментарием «зачем».
3. **Без новых CSS-файлов.** Всё в `ui/css/styles.css`.
4. **Цветовые состояния — через классы-маркеры.** `.card.success`, `.row.row-hold` — не дублируй `.success .btn`.
5. **Hover/active/focus на всём интерактивном.** `a`, `button`, `[tabindex]`, `.nav a`, `.card-link`.
6. **Accessibility:** `aria-label` на иконочных кнопках, `role="dialog"`+`aria-modal` на модалке, `:focus-visible` (не `:focus`) для outline.
7. **Числа — через `rub(kopecks)`** из `api.js`. `tabular-nums` — обязательно для колонок с суммами.
8. **Тексты — escape'нутые.** Пользовательские значения внутри HTML-строки — `escapeHtml(value)`.
9. **Новый компонент = новый раздел** в §3 + рецепт в SKILLS.md + апдейт README-AI.md.
10. **Специфичность полей формы.** Базовое `.form-field input/select/textarea` = класс+тип и перебивает
    одно-классовые правила потомков. Своё правило для поля внутри `.form-field` пиши как
    `.form-field .my-input`, иначе `height`/`padding`/`border` потеряются.
11. **Новый токен референса — сверяй с `_tokens.scss`.** Не изобретай значения: у Gentelella v4
    есть палитра, `--space-1..8` и `--radius/sm/lg`. Отступление — только с записью в §1.3.
12. **Цвет из данных — только через `cssColor()`.** Значение из БД (`account.color`,
    `category.color`) нельзя подставлять в атрибут `style` сырым: это вектор инъекции
    и способ протащить хардкод-цвет. `import { cssColor } from '../api.js'` — пропускает
    только hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`), иначе отдаёт fallback-токен.
    Классом такой цвет задать нельзя, поэтому инлайн здесь — единственный вариант.

---

## 5. Что отсутствует (пробелы)

Эти компоненты **нужно добавить** при необходимости. Не имитируй хардкодом — добавь класс.

- `.alert` / `.banner` — системные сообщения поверх контента (не toast).
- `.tooltip` — подсказка по наведению (сейчас `title=`).
- `.tabs` — горизонтальные табы (есть только частный `.icon-picker-tabs`).
- `.pagination` — постраничная навигация (сейчас `limit=500`).
- `.spinner` — визуальный индикатор загрузки (сейчас текст «Загрузка…»).
- `.switch` — on/off переключатель (есть `toggle-group`, но это radio).
- `.breadcrumb` — навигационная цепочка.
- `.avatar` — круглый аватар.
- **Dark mode toggle** — токены `[data-theme="dark"]` уже есть (§2.1.1), нужен переключатель в топбаре,
  pre-paint скрипт (без вспышки) и запись выбора в `localStorage`.

### 5.1. Известные пробелы в разметке

Закрыто в четвёртом проходе:

- `.page-summary-item` — теперь стилизован (`display: inline-flex`, `align-items: baseline`,
  `gap: 4px`), чтобы label и value не разъезжались при переносе строки.
- `.table-wrap-compact` — избыточный маркер удалён из `settings.js` (3 шт.):
  компактность уже даёт `.table-compact` на самой таблице.

### 5.2. Дефекты поведения

Найдено при замерах в браузере.

**Исправлено (по явному запросу владельца, `ui/js/ui/modal.js`):**

- **Combobox открывается только по вводу.** Добавлено открытие по явному действию
  пользователя — `click` по полю и `ArrowDown` на закрытом списке. Открытие по
  `focus` **намеренно не добавлено**: автфокус первой формы сразу распахивал бы
  список (исходное решение автора, сохранено).
- **Escape закрывал модалку вместе со списком.** Теперь при открытом списке
  `Escape` закрывает только список (`stopPropagation`), и лишь следующее нажатие —
  модалку.

**Исправлено (inline-стили → классы, четвёртый проход):**

| Было | Стало |
|------|-------|
| `transactions.js` `style="margin-top:16px\|12px"` (CTA в `.empty`) | `.empty-actions` |
| `transactions.js` inline-стиль на `.comment-input` | класс `.comment-input` (+ `:focus`) |
| `import-rules.js` `style="margin-left:8px"` | `.rules-intro a { margin-left }` |
| `accounts.js` / `simple-list.js` `style="font-weight:600;background:rgba(0,0,0,0.02)"` | `.table-total-row` (фон — токен `--hover-soft`) |
| `settings.js` `style="color:#dc2626"` | `style="color:var(--danger)"` |

**Исправлено (пятый проход — ненормативные инлайн-стили):**

| Было | Стало |
|------|-------|
| `accounts.js` 8 свойств на маркере счёта + fallback `'#999'` | `.acc-color-dot` + `background:${cssColor(a.color)}` |
| `accounts.js` `border-radius:6px` в обход токена | `.card-manager-row` → `var(--radius)` |
| `accounts.js` `font-family:ui-monospace,Menlo,monospace` | `.card-pan` → `var(--font-mono)` |
| `accounts.js`, `settings.js` `style="…${a.color}…"` / `${c.color}` без валидации | `cssColor()` из `api.js` (только hex, иначе fallback) |
| `accounts.js`, `simple-list.js` `style="color:var(--muted)"` | класс `.muted` |

**Почему остальные inline-стили оставлены.** Правило проекта (AGENTS.md §3) запрещает
инлайн-стили **с хардкод-цветами**; точечные инлайн-стили с токенами разрешены. Остаток
(~50 мест в 6 вьюхах) — это:
- **декларативная раскладка** — `width:` на `<th>` (ширины колонок), `flex`-обёртки
  в собранной вручную модалке карт (`accounts.js`);
- **функциональные переключатели** — `style="display:none"`, которыми JS показывает
  и скрывает «Сбросить» в фильтр-баре;
- **данные из БД** — `color`/`background` категорий и счетов, которые классом не
  задать в принципе; они уже прогнаны через `cssColor()`.

Цвета во всех этих местах идут через токены (`var(--muted)`, `var(--bg)`, `var(--border)`),
то есть правилу соответствуют. Механический перенос в классы дал бы ~15 новых классов
без функционального выигрыша и с риском регрессий — поэтому не делался.
Ручная модалка карт (`accounts.js`) вообще должна быть пересобрана на `openModal` —
тогда её инлайн-стили уйдут сами.

**Осталось:**

- Механический перенос остатка инлайн-стилей в классы — сознательно не делался,
  они соответствуют правилу (см. выше).
- Ручная модалка карт (`accounts.js`) — пересобрать на `openModal`.

Полный список и план — README-AI.md §5.

### 5.3. Дублирование хелперов — исправлено

`escapeHtml` был скопирован в **7 вьюх** (`accounts`, `transactions`, `import`,
`import-rules`, `settings`, `simple-list`, `_template`), `escapeAttr` — ещё в двух
(`settings`, `modal.js`). `_template.js` прямо предписывал вынести реализацию в `api.js`
при повторе в 3+ вьюхах — условие было перевыполнено.

Все реализации оказались **функционально идентичны** (два варианта отличались только
формой записи `v ?? ''` против `v === null || v === undefined`), поэтому объединены
в `api.js` без изменения поведения:

```js
export function escapeHtml(v) { /* единый алфавит: & < > " ' */ }
export function escapeAttr(v) { return escapeHtml(v) }
```

Проверено: 21 кейс (включая `null`/`undefined`/`0`/`NaN`/объекты/эмодзи/длинные строки)
даёт побайтово тот же результат, что **обе** прежние реализации; отпечаток DOM
(6283 элемента, 9 снимков) после рефакторинга не изменился.

Обновлены и носители рецепта: `SKILLS.md` больше не показывает локальное определение,
`AGENTS.md §1` перечисляет хелперы как экспорты `api.js`.