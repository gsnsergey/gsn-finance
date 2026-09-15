---
name: finans-design-system
description: |
  Load this skill when a task touches ui/** in the Finans project (Vanilla ES
  modules, hash router, single styles.css, Gentelella v4 style). Trigger phrases:
  "new view", "openModal form", "CRUD page", "правка styles.css", "новая вьюха",
  "стиль Gentelella", "тёмная тема", "add a card/table/button", "render(root)",
  anything that mentions ui/js/ or ui/css/. Use this to enforce the contract
  (no React/Tailwind/npm, single CSS, escapeHtml on user values, tokens only).
  Do NOT load for backend/**, CLI, cli/agent/, bin/_*.js, data/*.db — those
  have no UI contract.
---

# Finans Design System

Контракт для ИИ-агентов в проекте `/Users/gsn/- WORK/DEV/finans`.
Этот скилл — точка входа. Полные правила — в соседних MD в корне проекта.

## Стек (5 строк, неизменно)

Vanilla ES-модули, `<script type="module">`. Entry: `ui/js/app.js`. Hash-роутер: `ui/js/router.js`.
Вьюхи: `ui/js/views/*.js` экспортируют `render(root)`. API: `ui/js/api.js` (`api.get/post/patch/del`,
`rub`, `toast`, `fmtDay`, `todayIso`). Модалка: `ui/js/ui/modal.js#openModal({ title, fields, onSubmit })`.
Один CSS: `ui/css/styles.css` (~38 КБ). Иконки — FA 4 из `ui/vendor/font-awesome/`. Сборки и npm нет.

## Где читать полные правила

Прежде чем писать код — открой соответствующий MD в корне проекта:

| Нужно                              | Читай                           | Строк |
|------------------------------------|---------------------------------|-------|
| Токены, компоненты, HTML-примеры   | `../DESIGN.md`                  | 299   |
| Запреты, правила кода, чеклист     | `../AGENTS.md`                  | 101   |
| Готовые рецепты (CRUD, форма и т.п.)| `../SKILLS.md`                 | 249   |
| Навигация, шаблон промпта, частые ошибки агентов | `../README-AI.md` | 204   |

Карточки для Cursor — `../.cursor/rules/design-system.mdc`. Указатель для Claude Code — `../CLAUDE.md`.

## Жёсткие запреты (нарушать = откат)

- ❌ React/Vue/Svelte/Angular/Preact/Lit/Alpine/jQuery/Tailwind/Bootstrap/Material/CSS-in-JS.
- ❌ Новые CSS-файлы. Всё в `ui/css/styles.css`.
- ❌ npm-пакеты. `package.json` без изменений.
- ❌ `innerHTML` с пользовательскими значениями без `escapeHtml()`.
- ❌ Inline-стили с хардкод-цветами (только `var(--…)`).
- ❌ Новые типы полей в `openModal` без согласования (ломает все формы).
- ❌ Правки `ui/js/ui/modal.js` без явного запроса.

## Быстрый старт: новая вьюха

1. Создай `ui/js/views/<name>.js` → `export async function render(root)`.
2. Загрузи данные параллельно: `const [a, b] = await Promise.all([api.get('/api/a'), api.get('/api/b')])`.
3. Построй DOM через `root.innerHTML = '…'` (escape'ни все пользовательские значения).
4. Навешай обработчики через `root.querySelectorAll('[data-action="…"]')` после записи.
5. Зарегистрируй:
   - `ui/js/app.js` → `import { render as foo } from './views/foo.js'` + `register('/foo', foo)`
   - `ui/js/router.js` → в `titleMap`: `'/foo': 'Название'`
   - `ui/js/sidebar.js` → в `NAV`: `{ path: '/foo', label: 'Название', icon: 'star' }`

## Быстрый старт: форма

**Только через `openModal`.** Пример на 4 поля (text/number/select/textarea):

```js
import { openModal } from '../ui/modal.js'
import { api, toast } from '../api.js'

function openFooForm(root, item) {
  const isEdit = !!item
  openModal({
    title: isEdit ? 'Редактировать' : 'Новое',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields: [
      { name: 'name', label: 'Название', type: 'text', required: true, value: item?.name },
      { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, step: '0.01', value: item ? item.amount / 100 : undefined },
      { name: 'type', label: 'Тип', type: 'select', required: true, value: item?.type,
        options: [{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }] },
      { name: 'comment', label: 'Комментарий', type: 'textarea', value: item?.comment }
    ],
    onSubmit: async (data) => {
      const body = { ...data, amount: Math.round(Number(data.amount) * 100) }
      try {
        if (isEdit) await api.patch(`/api/foo/${item.id}`, body)
        else await api.post('/api/foo', body)
        toast(isEdit ? 'Сохранено' : 'Создано', 'success')
        render(root)
      } catch (e) { throw e }  // modal.js сам покажет .form-error
    }
  })
}
```

Типы полей, доступные в `fields`: `text`, `number`, `date`, `select`, `textarea`, `checkbox`, `toggle`, `combobox`, `category-select`, `color`. Полный список — `ui/js/ui/modal.js:19-122`.

## Золотые эталоны (копируй их паттерны)

| Файл                                       | Что копировать                                               |
|--------------------------------------------|--------------------------------------------------------------|
| `ui/js/views/transactions.js`               | CRUD + фильтры + `Promise.all` + `data-action` + debounce + inline-edit + `openModal` |
| `ui/js/views/accounts.js`                  | `.page-toolbar` + итоговая строка + раскрывающийся список через `[hidden]` |
| `ui/js/views/dashboard.js`                 | 7 параллельных endpoint'ов + кликабельные `.card.card-link` + `await import()` модалки |
| `ui/js/ui/modal.js`                        | НЕ редактируй. Все формы зависят от его API.                 |

## Ключевые токены (шпаргалка)

| Токен            | Назначение                              |
|------------------|-----------------------------------------|
| `--bg`           | Фон страницы (`#f7f8fa`)                |
| `--surface`      | Карточки/топбар/сайдбар (`#fff`)        |
| `--text`         | Основной текст (`#1a1f2c`)              |
| `--muted`        | Подписи, мета (`#6b7280`)               |
| `--border`       | Границы (`#e5e7eb`)                     |
| `--accent`       | Синий — ссылки/primary/focus (`#2563eb`)|
| `--success`      | Зелёный — доход/прибыль (`#16a34a`)     |
| `--danger`       | Красный — расход/удаление (`#dc2626`)   |
| `--warning`      | Жёлтый — HOLD (`#f59e0b`)               |
| `--radius`       | Радиус карточек (`10px`)                 |
| `--shadow`       | Мягкая тень карточек                     |

Полная таблица (состояния, шкала отступов, радиусы, тени, z-index, брейкпоинты) — `DESIGN.md §2`.

## Чеклист перед завершением

- [ ] `package.json` без изменений (нет новых зависимостей).
- [ ] Нет новых CSS-файлов.
- [ ] Только классы из `ui/css/styles.css`. Если добавил новый — он в `DESIGN.md §3`.
- [ ] Токены, не хардкод цветов/радиусов/теней.
- [ ] Все пользовательские значения в `innerHTML` обёрнуты в `escapeHtml()`.
- [ ] Вьюха экспортирует `render(root)` (async при `await`).
- [ ] Hover/active/focus на всём интерактивном.
- [ ] После удаления/правки — UI обновляется (`render(root)` или `loadAndRenderTable()`).
- [ ] Новый компонент → обновлены `DESIGN.md §3` и `SKILLS.md`.

## Анти-паттерны (замечены у других агентов)

- Свой `openModal` внутри вьюхи — есть в `ui/modal.js`, используй его.
- `id="…"` на динамических элементах — только `data-*`, иначе коллизии.
- `await` в `for` без надобности — `Promise.all` быстрее.
- `confirm()` для неразрушительных действий — toast достаточно.
- TODO без даты/владельца — запрещено.

## Что НЕ покрыто контрактом (если попросят добавить)

DESIGN.md §5 + README-AI.md §5 — список того, чего ещё нет в проекте:
`.alert`, `.tooltip`, `.tabs`, `.pagination`, `.spinner`, `.switch`, `.breadcrumb`, `.avatar`.
Тёмная тема — отдельный раздел (есть план), добавляется через `:root[data-theme="dark"]` + переопределение токенов.
