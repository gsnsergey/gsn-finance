# AGENTS.md — Правила для ИИ-агентов

> Дизайн-система — в **DESIGN.md**. Рецепты — в **SKILLS.md**.
> Этот файл — про **архитектуру и ограничения**.

## 1. Стек (точно как есть)

- **HTML:** один `ui/index.html`. Бандлеров/SSR/SPA-фреймворков нет.
- **JS:** нативные ES-модули (`<script type="module">`). Импорты — только между `ui/js/**`.
- **Entry:** `ui/js/app.js`. **Роутер:** `ui/js/router.js` (hash-based: `#/transactions?from=…`).
- **API:** `ui/js/api.js` (`api.get/post/patch/del`, `rub`, `toast`, `fmtDay`, `todayIso`).
- **Сайдбар:** `ui/js/sidebar.js`. **Модалка:** `ui/js/ui/modal.js` (`openModal({ title, fields, onSubmit })`).
- **Вьюхи:** `ui/js/views/*.js` экспортируют `async function render(root)`.
- **Справочники:** `ui/js/data/*.js` — статические массивы.
- **CSS:** ОДИН файл `ui/css/styles.css` (~38 КБ). Без препроцессоров.
- **Иконки:** Font Awesome 4 из `ui/vendor/font-awesome/`.
- **Сборки нет.** Файлы отдаются Node-бэкендом как есть.

## 2. Архитектура

**Жизненный цикл вьюхи:** `router.js#render()` ставит `.loading` в `#view` → достаёт вьюху из `routes` Map → `await view(root)` → вьюха заполняет `root`. При ошибке `root.innerHTML = "<div class='empty'>…</div>"`.

**Контракт `render(root)`:** `root` — `<section id="view">`. Возвращать ничего не нужно. Для перерендера внутри вьюхи — `render(root)` (рекурсивно) или точечный `loadAndRenderTable()`.

**Базовые импорты:**
```js
import { api, rub, toast, todayIso, fmtDay } from '../api.js'
import { openModal } from '../ui/modal.js'
import { categoryIconHTML } from '../data/categoryIcons.js'
import { bankLabel, currencyLabel, ... } from '../data/*.js'
```

**Hash с параметрами** (`#/transactions?from=…&to=…&type=…`) — `transactions.js:30-40` показывает, как читать через `URLSearchParams(hash.slice(qIdx+1))`. Используй этот паттерн для глубоких ссылок (дашборд так делает для карточек «Доход/Расход сегодня»).

## 3. Строгие запреты

Без исключений. Если задача требует чего-то из списка — **сначала спроси**.

- ❌ React/Vue/Svelte/Angular/Preact/Lit/Alpine/jQuery, любые SPA-фреймворки.
- ❌ Tailwind/Bootstrap/Material, любые UI-киты, CSS-in-JS.
- ❌ Inline-стили с хардкод-цветами (допустимы только точечно, только с токенами).
- ❌ Новые CSS-файлы. Всё — в `ui/css/styles.css`.
- ❌ npm-пакеты. Не делать `npm install …` без явного запроса.
- ❌ Новые типы полей в `openModal` без согласования (это ломает все формы).
- ❌ Правки `ui/js/ui/modal.js` без явного запроса (центральный компонент).

## 4. Правила написания кода

### CSS

Все цвета/тени/радиусы — через `var(--…)`. Новый класс — только если существующие не подходят, в конец `styles.css` с комментарием «зачем». Группируй селекторы по компоненту, секции разделяй `/* === Name === */`. `:focus-visible` (не `:focus`) для outline. `transition` короткий (0.1–0.2s) на background/color/border-color/transform.

### JS (вьюхи)

- Параллельные `api.get(...)` через `Promise.all`, где можно.
- Обработчики **после** записи DOM. Если `innerHTML` — навешивай через `root.querySelectorAll('[data-action="…"]')`.
- Идентификаторы в HTML — `data-id="…"`, не `id`.
- `escapeHtml(value)` для **любых пользовательских строк**, попадающих в HTML.
- `confirm()` — только для удаления.
- После мутации — `await render(root)` или `loadAndRenderTable()`.

### API (`ui/js/api.js`)

Не расширяй `api.*` методами одной вьюхи — делай endpoint руками `api.get('/api/…')`. Ошибки — через существующую обёртку `errorMessage`.

### Разметка

Допустимы два стиля:
1. **Шаблонные строки + `innerHTML`** — для статической разметки с серверными данными. Приемлемо, если каждое пользовательское значение в `escapeHtml()`. Сейчас так: `transactions.js`, `accounts.js`, `dashboard.js`.
2. **`document.createElement` + классы** — для динамики (inline-edit, добавление/удаление строк, новых элементов после рендера). Так: `modal.js`, контейнер `.table-section` в `transactions.js`.

Для **нового** кода предпочтителен стиль (2). Стиль (1) допустим при условиях: разметка известна заранее, `escapeHtml()` на пользовательских значениях, блок ≤ 100 строк.

**Запрещено:** `innerHTML` с пользовательским вводом без `escapeHtml()` (XSS); `<input value="${userInput}">` даже с escape (используй `setAttribute` или `value=`).

### Документирование

Комментарии — «зачем», не «что». Нетривиальные архитектурные точки — обязательно поясняй (пример: `dashboard.js:43-49` — почему карточка в `<a>`).

## 5. Эталонные view-файлы

| Файл                                    | Зачем копировать                                                       |
|-----------------------------------------|------------------------------------------------------------------------|
| `ui/js/views/transactions.js` (≈430 строк)| Золотой стандарт: CRUD + фильтры + `Promise.all` + `data-action` + debounce поиска + inline-edit комментария + `openModal` для create/edit. |
| `ui/js/views/accounts.js`               | `.page-toolbar` + `.page-summary` + actions справа; итоговая строка; раскрывающийся список карт через `data-action="cards-toggle"` + `[hidden]`. |
| `ui/js/views/dashboard.js`              | 7 параллельных endpoint'ов через `Promise.all`; кликабельные карточки `.card.card-link`; динамический импорт модалки через `await import('./transactions.js')`. |

`ui/js/ui/modal.js` — **не редактируй без явного запроса**: все формы в проекте зависят от его API. Если нужно новое поле — добавь `type` в `renderField`, но сначала проверь, что нет способа собрать форму из существующих типов.

## 6. Чеклист перед завершением

- [ ] Нет новых зависимостей (`package.json` без изменений).
- [ ] Нет новых CSS-файлов.
- [ ] Только классы из `styles.css`. Если добавил — он в `DESIGN.md §3`.
- [ ] Токены, не хардкод цветов/радиусов/теней.
- [ ] Все пользовательские значения в `innerHTML` обёрнуты в `escapeHtml()`.
- [ ] Вьюха экспортирует `render(root)` (async при `await`).
- [ ] Стиль Gentelella (плотная сетка, один акцент, мягкие тени).
- [ ] Hover/active/focus на всём интерактивном.
- [ ] После удаления/правки — UI обновляется.
- [ ] Новый компонент → обновлены `DESIGN.md §3` и `SKILLS.md`.
- [ ] Анти-паттерны не использованы: свой `openModal` (используй `ui/modal.js`); `id=` на динамике (только `data-*`); `await` в `for` без нужды (`Promise.all`); TODO без даты/владельца.