# SKILLS.md — Рецепты для типовых задач

> Короткие шаблоны с реальными импортами проекта.
> **Перед рецептом — прочитай AGENTS.md §3 и DESIGN.md §3.**

---

## 1. Создать новую вьюху

**Файлы:** `ui/js/views/<name>.js`, регистрация в `ui/js/app.js`.

```js
// ui/js/views/foo.js
import { api, rub, toast, escapeHtml } from '../api.js'
import { openModal } from '../ui/modal.js'

export async function render(root) {
  const items = await api.get('/api/foo')
  root.innerHTML = `
    <div class="page-toolbar">
      <div class="page-summary">
        <span class="page-summary-label">Итого</span>
        <span class="page-summary-value">${rub(items.reduce((s, x) => s + x.amount, 0))}</span>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="add-foo">+ Добавить</button></div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Название</th><th class="num">Сумма</th></tr></thead>
        <tbody>
          ${items.map(x => `<tr><td>${escapeHtml(x.name)}</td><td class="num">${rub(x.amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `
  document.getElementById('add-foo').addEventListener('click', () => openFooForm(root, null))
}

function openFooForm(root, item) { /* см. §2 */ }
```

> `escapeHtml` / `escapeAttr` / `cssColor` — из `api.js`, **не определяй их локально**.
> Раньше рецепт показывал локальную реализацию, из-за чего она разошлась по 7 вьюхам.

Регистрация: `app.js` → `import { render as foo } from './views/foo.js'` + `register('/foo', foo)`;
`router.js` → в `titleMap`: `'/foo': 'Что-то'`;
`sidebar.js` → в `NAV`: `{ path: '/foo', label: 'Что-то', icon: 'star' }`.

---

## 2. Форма через `openModal`

**Не пиши свою модалку.** Используй `ui/js/ui/modal.js`.

```js
function openFooForm(root, item) {
  const isEdit = !!item
  openModal({
    title: isEdit ? 'Редактировать' : 'Новое',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields: [
      { name: 'name', label: 'Название', type: 'text', required: true, value: item?.name },
      { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, step: '0.01', value: item ? item.amount / 100 : undefined },
      {
        name: 'type', label: 'Тип', type: 'select', required: true, value: item?.type,
        options: [{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }]
      },
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

**Типы полей:** `text`, `number`, `date`, `select`, `textarea`, `checkbox`,
`toggle`, `combobox`, `category-select`, `color` (см. `modal.js:19-122`).

**Если полей не хватает** — динамический список, своя форма внутри модалки, —
не собирай диалог вручную: у `openModal` есть режим своего тела.

```js
let host = null
function draw() {                       // перерисовывается после каждой мутации
  host.innerHTML = `<div class="my-list">…</div>
    <form class="my-add-form"><input name="x" required><button class="btn btn-primary">+ Добавить</button></form>`
  host.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault()
    await api.post('/api/…', { x: host.querySelector('[name=x]').value })
    draw()                              // диалог при этом живёт
  })
}
openModal({
  title: 'Заголовок',
  wide: true,                           // 520px вместо 480
  closeLabel: 'Готово',
  body: (bodyHost) => { host = bodyHost; draw() },
  onClose: () => render(root),          // сработает при ЛЮБОМ способе закрытия
})
```

Контейнер в этом режиме — `div`, а не `form` (вложенные `<form>` браузер не
поддерживает), поэтому свою форму вешай сам в `body`/`onMount`. Живой пример —
модалка «Карты счёта» в `accounts.js`.

## 3. CRUD-страница (list + create + edit + delete)

Полный эталон — `ui/js/views/transactions.js`. Ключевые идеи:

- **Тулбар:** `.page-toolbar` с `.page-summary` слева и `.page-actions` справа.
- **Таблица:** `.table-wrap > .table`, колонка actions со `.row-actions` (горизонтально).
- **Перерендер:** вынеси `loadAndRenderTable()` отдельно — пересоздаёт `.table-section`, не весь `root`.
- **Кнопки:** `data-action="edit"` / `data-action="delete"` → единый `forEach` после `innerHTML`.
- **После save/delete:** `render(root)` или `loadAndRenderTable()`.
- **Суммы:** в БД — копейки (integer). В форме — рубли. `kopecks = Math.round(rubles * 100)`.
- **Даты:** ISO `YYYY-MM-DD` через `todayIso()`.

## 4. Таблица с данными

```html
<div class="table-wrap">
  <table class="table">
    <thead><tr><th>Дата</th><th>Название</th><th class="num">Сумма</th><th style="width:80px"></th></tr></thead>
    <tbody>
      ${rows.map(r => `<tr data-id="${r.id}">
        <td>${fmtDay(r.date)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="num ${r.amount < 0 ? 'num-expense' : 'num-income'}">${rub(r.amount)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="edit" data-id="${r.id}">✎</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">×</button>
        </div></td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>
```

Пусто — `.empty` внутри `.table-wrap` вместо `<table>`.

---

## 5. Карточки дашборда (ровно 5 в строке)

```html
<div class="cards">
  <a class="card card-link" href="#/foo">
    <div class="card-label">Заголовок</div>
    <div class="card-value">${rub(total)}</div>
    <div class="card-sub">пояснение</div>
  </a>
  <div class="card accent">   <!-- синий value -->
  <div class="card success">  <!-- зелёный value -->
  <div class="card danger">   <!-- красный value -->
</div>
```

Брейкпоинты сами уменьшат до 3/2/1 колонки (DESIGN.md §2.8).

---

## 6. Подтверждение удаления

```js
// Просто
if (!confirm('Удалить запись?')) return

// Красиво — через openModal с подтверждением ввода
openModal({
  title: 'Удалить запись',
  fields: [{ name: 'confirm', label: 'Введите "УДАЛИТЬ"', type: 'text', required: true }],
  submitLabel: 'Удалить',
  onSubmit: async (data) => {
    if (data.confirm !== 'УДАЛИТЬ') throw new Error('Неверное подтверждение')
    await api.del(`/api/foo/${id}`)
    toast('Удалено', 'success')
    render(root)
  }
})
```

---

## 7. Toast и FA-иконки

```js
import { toast } from '../api.js'
toast('Сохранено', 'success')      // 2.4с, затирает предыдущий
toast('Ошибка: ...', 'error')
```

```html
<i class="fa fa-tachometer"></i>   <!-- полный список в ui/vendor/font-awesome/ -->
<button class="btn"><i class="fa fa-plus"></i> Добавить</button>
```

---

## 8. Тулбар с фильтрами

Паттерн `transactions.js:212-258`. Структура:

```html
<div class="page-toolbar page-toolbar--filters">
  <div class="filters-bar filters-bar--inline">
    <label class="filter"><span>Период</span>
      <select data-filter="period"><option value="">Все</option><option value="month">Месяц</option></select>
    </label>
    <label class="filter"><span>Поиск</span><input type="text" data-filter="q" placeholder="..."></label>
    <button class="btn btn-sm" id="filters-bar-reset" style="display:none">Сбросить</button>
    <button class="btn btn-primary" id="add-foo">+ Добавить</button>
  </div>
</div>
```

```js
const debouncedQ = debounce(() => loadAndRenderTable(), 300)
root.querySelectorAll('[data-filter]').forEach(el => {
  const key = el.dataset.filter
  const ev = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change'
  el.addEventListener(ev, () => {
    filters[key] = el.value
    document.getElementById('filters-bar-reset').style.display = Object.values(filters).some(v => v) ? '' : 'none'
    key === 'q' ? debouncedQ() : loadAndRenderTable()
  })
})
```

---

## 9. Глубокая ссылка с фильтрами

```js
// В дашборде:
const href = `#/transactions?from=${today.date}&to=${today.date}&type=expense`

// В принимающей вьюхе:
const qIdx = (window.location.hash || '').indexOf('?')
if (qIdx >= 0) {
  const params = new URLSearchParams(window.location.hash.slice(qIdx + 1))
  filters.from = params.get('from') || ''
  // ...
}
```

Полный пример — `transactions.js:30-40`.

---

## 10. Новый справочник в `data/`

```js
// ui/js/data/foos.js
export const FOOS = [{ value: 'a', label: 'Вариант А' }, { value: 'b', label: 'Вариант Б' }]
export const fooLabel = v => FOOS.find(f => f.value === v)?.label || v || '—'
```

```js
import { FOOS, fooLabel } from '../data/foos.js'
// В форме: { name: 'foo', type: 'select', options: FOOS }
// В таблице: <td>${fooLabel(row.foo)}</td>
```

Динамические данные — это **не** справочник, а `await api.get(...)`.

## 11. Обновить DESIGN.md и SKILLS.md

После нового компонента: `styles.css` → новый класс с комментарием; `DESIGN.md §3` → запись; `§2` если новый токен; `SKILLS.md` → рецепт (если часто). Подробнее — README-AI.md §3.