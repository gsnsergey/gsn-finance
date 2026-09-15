# DESIGN.md — Дизайн-система проекта Finans

> Этот файл — **единственный источник правды** по визуальному стилю.
> Любая новая вьюха, компонент или правка CSS должны сверяться с ним.
> Обновлять — при добавлении новых токенов/компонентов (см. README-AI.md).

---

## 1. Философия стиля

Плотная, но дышащая сетка; один акцент (синий `#2563eb`); мягкие тени и небольшие
радиусы; таблицы как основной носитель информации; аккуратный сайдбар с FA-иконками;
пастельные «бейджи» для типов; ноль шумных анимаций.

**Визуальный ориентир — Gentelella v4** (Colorlib). Это явный референс, а не
«похожий стиль». Все визуальные решения сверяются с ним.

- **Live demo:** https://preview.colorlib.com/theme/gentelella/
- **Исходники:** https://github.com/ColorlibHQ/gentelella
- **Стек референса:** vanilla JS + SCSS + Vite 8. **Без Bootstrap, без jQuery** — наш стек совпадает.

### 1.1. Ключевые принципы Gentelella v4 (что мы наследуем)

1. **Один CSS-файл, одни токены.** Цвета/тени/радиусы — через `var(--…)`. Хардкод — только как исключение (`:root`, градиент бренда).
2. **Контент первичен.** Карточки не дышат — `gap 16px`, `padding 16px`. Таблицы — максимум строк во вьюпорте.
3. **Иерархия без украшательства.** Primary = синий, Danger = красный outline, Ghost = `var(--surface)` с бордером. Не изобретай новых вариантов кнопок.
4. **Локализация.** Тексты — по-русски. Числа — `ru-RU` (`1 500,50 ₽`). Десятичный разделитель в полях — запятая.
5. **Иконки — FA 4.** Никаких SVG-спрайтов, эмодзи только в `categoryIcons.js`.

### 1.2. Что уже соответствует Gentelella v4

| Узел            | Статус | Где в проекте                                  |
|-----------------|--------|------------------------------------------------|
| Sidebar + rail  | ✅     | `.sidebar`, `.sidebar-hidden` (rail-collapse)  |
| Topbar          | ✅     | `.topbar` + `.sidebar-toggle`                  |
| Cards (стат.)   | ✅     | `.card`, `.cards` (5 колонок)                  |
| Tables          | ✅     | `.table`, `.table-wrap`, sticky thead          |
| Modal + backdrop| ✅     | `.modal`, `.modal-backdrop` (openModal)        |
| Toast           | ✅     | `#toast`, `.toast.error`/`.success`            |
| Badges          | ✅     | `.badge`, `.badge-info`/`.warn`/etc.           |
| Filters-bar     | ✅     | `.filters-bar`, `.filters-bar--inline`         |
| Brand mark      | ✅     | `.brand`, `.brand-dot` (gradient)              |
| Tabs            | ❌     | только частный `.icon-picker-tabs`             |
| Breadcrumbs     | ❌     | отсутствуют                                    |
| Dark mode       | ❌     | есть план, не реализовано                      |
| DataTables      | ❌     | обычная таблица без sort/paginate              |
| ⌘K palette      | ❌     | отсутствует                                    |
| Charts          | ❌     | нет (только стат-карточки)                     |
| Pagination      | ❌     | `limit=500`, без пагинации                     |
| Theme generator | ❌     | цвета захардкожены, без live-настройки         |

Полный чек-лист фич референса — в README.md ColorlibHQ/gentelella. Перед стартом
большой задачи — сверяйся с `playground.html` демо (живые примеры компонентов).

---

## 2. Токены (CSS-переменные в `:root`)

### 2.1. Цвета

| Токен              | Значение     | Назначение                                          |
|--------------------|--------------|-----------------------------------------------------|
| `--bg`             | `#f7f8fa`    | Фон страницы (внешний «воздух» вокруг карточек)     |
| `--surface`        | `#ffffff`    | Поверхности: карточки, топбар, сайдбар, таблицы     |
| `--text`           | `#1a1f2c`    | Основной цвет текста                                |
| `--muted`          | `#6b7280`    | Второстепенный текст (подписи, мета, плейсхолдеры)  |
| `--border`         | `#e5e7eb`    | Границы инпутов, карточек, разделители строк        |
| `--accent`         | `#2563eb`    | Основной акцент (ссылки, primary, focus-ring)       |
| `--accent-hover`   | `#1d4ed8`    | Hover для primary-кнопок                            |
| `--success`        | `#16a34a`    | Зелёный: доход, прибыль, успешный toast             |
| `--danger`         | `#dc2626`    | Красный: расход, убыток, удаление, ошибки           |
| `--warning`        | `#f59e0b`    | Жёлтый: HOLD-операции, бейдж `.badge-warn`          |

> **Алиасы** (не `:root`, но закреплённые константы в коде):
> `#1a8754` — зелёный `profit-pos` (специально не на `--success`, чтобы выделять
> P&L портфеля); `#2563eb → #7c3aed` — градиент бренда в `.brand-dot`.

### 2.2. Состояния (hover/active/focus/disabled)

| Контекст           | Правило                                                              |
|--------------------|----------------------------------------------------------------------|
| Hover на `.btn`    | `background: rgba(0,0,0,0.04)`                                       |
| Hover на `.btn-primary` | `background: var(--accent-hover); border-color: var(--accent-hover)` |
| Hover на `.nav a`  | `background: rgba(0,0,0,0.04); color: var(--text)`                   |
| Active (`.active`) | `background: rgba(37,99,235,0.08); color: var(--accent)`             |
| Focus ring         | `outline: 2px solid var(--accent); outline-offset: 1px` или 2px      |
| Disabled `.btn:disabled` | `opacity: 0.5; cursor: not-allowed`                              |

### 2.3. Типографика

- **Семейство:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`.
- **Базовый размер:** `14px` (`html, body { font-size: 14px; line-height: 1.5; }`).
- **Шкала размеров:** `11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 px`.
- **Веса:** `500` (UI-элементы), `600` (заголовки/бейджи), `700` (карточные значения и бренд).
- **Monospace:** `ui-monospace, "SF Mono", Menlo, monospace` — для PAN-масок, hex-кодов, тикеров.
- **Uppercase + tracking:** для подписей (`text-transform: uppercase; letter-spacing: 0.04em`).

### 2.4. Отступы (spacing scale)

Не переменные, устоявшаяся сетка: 2/4/6/8/10/12/16/24/32 px. Примеры:
2 — между иконками в `.row-actions`; 8 — padding `.btn`; 12 — padding таблиц;
16 — `.card`, `.topbar`, gap `.cards`; 24 — `.view`, `.modal`; 32 — горизонтальный padding.

### 2.5. Радиусы

| Класс / токен              | Значение | Где                                              |
|----------------------------|----------|--------------------------------------------------|
| `--radius`                 | `10px`   | Карточки, `.table-wrap`, `.filters-bar`           |
| `.btn`                     | `8px`    | Все кнопки                                       |
| `.modal`                   | `12px`   | Модалка                                          |
| `.form-field input/select` | `6px`    | Поля ввода                                       |
| `.badge`                   | `999px`  | Бейджи (таблетка)                                |
| `.color-swatch`, `.brand-dot` | `6px` | Квадраты выбора цвета, логотип                |

### 2.6. Тени

| Токен / правило                          | Назначение                                |
|------------------------------------------|-------------------------------------------|
| `--shadow` (`0 1px 2px … 0 4px 12px …`)   | Карточки, `.table-wrap`, `.filters-bar`   |
| `box-shadow: 0 4px 12px rgba(0,0,0,0.08)`| `.card-link:hover`                         |
| `box-shadow: 0 4px 16px rgba(0,0,0,0.1)` | `.category-select-dropdown`, `.combobox-dropdown`, `.import-menu-dropdown` |
| `box-shadow: 0 10px 40px rgba(0,0,0,0.2)`| `.modal`                                  |

### 2.7. Z-index

| Слой                 | z-index | Примеры                                  |
|----------------------|---------|------------------------------------------|
| Контент              | `auto`  | Карточки, таблицы                        |
| Sticky thead         | `1`     | `.table th`                              |
| Dropdown-меню        | `50`    | `.category-select-dropdown`, `.import-menu-dropdown` |
| Toast                | `100`   | `#toast`                                 |
| Modal backdrop       | `200`   | `.modal-backdrop`                        |

### 2.8. Брейкпоинты (responsive)

| Ширина        | Что меняется                                                       |
|---------------|--------------------------------------------------------------------|
| ≤ 1280px      | `.cards` → 3 колонки вместо 5                                      |
| ≤ 768px       | `.app` → одна колонка; сайдбар `display: none`; паддинги 16px     |
| ≤ 480px       | `.cards` → 1 колонка                                                |

---

## 3. Компоненты

Для каждого: **назначение**, **классы**, **HTML-скелет**, **do/don't**.

### 3.1. Layout shell

`.app` (grid 240px / 1fr, min-height 100vh) → `.sidebar#sidebar` + `.content` (`.topbar` + `.view#view`).
Всё смонтировано в `ui/index.html`, вьюхи только пишут в `#view`.
`.app.sidebar-hidden` → первая колонка `0fr` (плавное сворачивание, состояние в `localStorage.sidebar.hidden`).

### 3.2. Сайдбар

| Класс           | Назначение                                                       |
|-----------------|------------------------------------------------------------------|
| `.brand`        | Логотип-ссылка (`.brand-dot` + «Finans»)                         |
| `.nav`          | Контейнер пунктов                                                |
| `.nav-section`  | Заголовок секции (uppercase, muted)                              |
| `.nav a`        | Пункт меню (`.active` — текущий)                                 |
| `.nav-icon`     | FA-иконка                                                        |

```html
<a href="#/transactions" class="active">
  <i class="fa fa-exchange nav-icon"></i>Операции
</a>
```

### 3.3. Кнопки `.btn`

| Класс               | Назначение                                           |
|---------------------|------------------------------------------------------|
| `.btn`              | Ghost: белый фон, бордер, `hover: rgba(0,0,0,0.04)` |
| `.btn-primary`      | Синий фон, белый текст (главное действие)            |
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
- `.table-import` — компактная для превью импорта (padding 6×8, шрифт 12px).
- `.table-compact` — для настроек (padding 5×10).
- `.row-actions` — кнопки действий в строке (горизонтально справа).
- `.tx-row` — кликабельная строка (дашборд).
- Цвета сумм: `.num.num-expense` → `--danger`, `.num.num-income` → `--success`,
  `.profit-pos` → `#1a8754`, `.profit-neg`/`.amt-neg` → `--danger`.
- Пусто — `.empty` внутри `.table-wrap` вместо `<table>`.

### 3.6. Бейджи `.badge`

`.badge-expense` / `.badge-income` / `.badge-info` / `.badge-warn` / `.badge-ok` / `.badge-error`.
Для типа категории: `.cat-type.cat-type-expense` / `.cat-type.cat-type-income`.

### 3.7. Модалка

В коде — **только через `openModal({ title, fields, onSubmit })`** из `ui/js/ui/modal.js`. Не создавай модалки вручную.

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

`.form-field` — вертикальный layout. `.form-grid` — двухколоночная сетка. `.form-row` — inline.
Типы полей в `openModal`: `select`, `textarea`, `checkbox`, `toggle`, `color`, `category-select`, `combobox` (полный список — `modal.js`).

### 3.8. Фильтры и тулбар

| Класс                    | Назначение                                                |
|--------------------------|-----------------------------------------------------------|
| `.filters-bar`           | Карточка-строка фильтров над таблицей                     |
| `.filters-bar--inline`   | Inline внутри `.page-toolbar` (без рамки)                 |
| `.filter`                | Контейнер одной группы (label + input)                    |
| `.page-toolbar`          | `[фильтры / итоги] + [actions справа]`                    |
| `.page-toolbar--filters` | Без прижатия actions к правому краю (для transactions)    |
| `.page-summary`          | Сводка слева в тулбаре (`Итого`, «Активных N»…)           |
| `.page-actions`          | Кнопки справа                                             |
| `.page-header`           | `h2 + actions` (без тулбара)                              |
| `.view-mode-toggle`      | Сегментированный переключатель режимов                    |

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

### 3.11. Pickers

Используются только через `openModal` (поля `type: 'category-select'` / `'color'`). Не строй свои.

### 3.12. Состояния

| Класс          | Назначение                                          |
|----------------|-----------------------------------------------------|
| `.loading`     | Текст «Загрузка…» в `#view` до получения данных    |
| `.empty`       | Пусто (карточка с пояснением и CTA)                 |
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

---

## 4. Правила использования

1. **Всегда токены, не хардкод.** `var(--accent)`, не `#2563eb` (исключения — §2.1).
2. **Переиспользуй существующие классы.** Новый — только если подходящего нет, в конец `styles.css` с комментарием «зачем».
3. **Без новых CSS-файлов.** Всё в `ui/css/styles.css`.
4. **Цветовые состояния — через классы-маркеры.** `.card.success`, `.row.row-hold` — не дублируй `.success .btn`.
5. **Hover/active/focus на всём интерактивном.** `a`, `button`, `[tabindex]`, `.nav a`, `.card-link`.
6. **Accessibility:** `aria-label` на иконочных кнопках, `role="dialog"`+`aria-modal` на модалке, `:focus-visible` (не `:focus`) для outline.
7. **Числа — через `rub(kopecks)`** из `api.js`. `tabular-nums` — обязательно для колонок с суммами.
8. **Тексты — escape'нутые.** Пользовательские значения внутри HTML-строки — `escapeHtml(value)`.
9. **Новый компонент = новый раздел** в §3 + рецепт в SKILLS.md + апдейт README-AI.md.

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

Полный список и план — README-AI.md §5.