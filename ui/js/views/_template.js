// =============================================================================
// _template.js — стартовый шаблон новой вьюхи для проекта Finans
// =============================================================================
//
// Использование:
//   1. Скопируй: `cp ui/js/views/_template.js ui/js/views/<name>.js`
//   2. Переименуй функцию `render` (опционально — имя одинаковое везде)
//   3. Замени `RESOURCE` на имя сущности (например, "goals")
//   4. Заполни колонки таблицы, поля формы, эндпоинты API
//   5. Зарегистрируй:
//        - ui/js/app.js     → `import { render as goals } ...` + `register('/goals', goals)`
//        - ui/js/router.js  → в `titleMap`: `'/goals': 'Цели'`
//        - ui/js/sidebar.js → в `NAV`: `{ path: '/goals', label: 'Цели', icon: 'star' }`
//
// Этот файл НЕ регистрируется в роутере и НЕ экспортируется куда-то ещё.
// Подчеркивание в имени — conventional «служебный, не view».
//
// Контракт: см. DESIGN.md, AGENTS.md, SKILLS.md
// Эталон:  ui/js/views/transactions.js
// =============================================================================

import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'

// Локальный escapeHtml — только для этого шаблона. Если встречается в 3+
// вьюхах — вынеси в api.js (см. AGENTS.md §4.4 «анти-паттерны»).
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// =============================================================================
// Главная вьюха
// =============================================================================

export async function render(root) {
  // ---------- 1. Параллельная загрузка ----------
  // Все api.get(...) без зависимостей друг от друга — объединяй в Promise.all.
  const [items, accounts] = await Promise.all([
    api.get('/api/RESOURCE'),
    api.get('/api/accounts')  // пример: зависимая сущность для форм
  ])

  // ---------- 2. Состояние фильтров (замыкание) ----------
  // Любая правка фильтра → пересборка таблицы. Смотри loadAndRenderTable ниже.
  const filters = { q: '', accountId: '', type: '', from: '', to: '' }

  // ---------- 3. Поддержка глубоких ссылок ----------
  // Дашборд может вести сюда с предзаполненными фильтрами:
  //   #/RESOURCE?from=2026-09-01&type=expense
  // Шаблон — см. transactions.js:30-40
  const hash = window.location.hash || ''
  const qIdx = hash.indexOf('?')
  if (qIdx >= 0) {
    try {
      const params = new URLSearchParams(hash.slice(qIdx + 1))
      for (const k of Object.keys(filters)) {
        const v = params.get(k)
        if (v) filters[k] = v
      }
    } catch { /* malformed query — игнорируем */ }
  }

  // ---------- 4. Построение query-string ----------
  // Backend понимает те же имена параметров, что у нас в filters.
  function buildQuery() {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
    params.set('limit', '500')
    return `?${params.toString()}`
  }

  // ---------- 5. Таблица с actions ----------
  // .table-section создаётся через createElement, чтобы перерисовывать только
  // её, а не весь root. Это быстрее и не теряет обработчики тулбара.
  async function loadAndRenderTable() {
    let list
    try {
      list = await api.get(`/api/RESOURCE${buildQuery()}`)
    } catch (e) {
      toast('Не удалось загрузить: ' + e.message, 'error')
      return
    }

    const sec = root.querySelector('.table-section') || (() => {
      const d = document.createElement('div')
      d.className = 'table-section'
      root.appendChild(d)
      return d
    })()

    const anyFilterActive = Object.values(filters).some(v => v)
    const emptyHtml = anyFilterActive
      ? `<div class="empty">
          <div class="empty-title">Нет записей по фильтру</div>
          <div style="margin-top:12px"><button class="btn btn-sm" id="empty-reset">Сбросить фильтры</button></div>
        </div>`
      : `<div class="empty">
          <div class="empty-title">Пока пусто</div>
          Нажми «+ Добавить», чтобы создать первую запись.
        </div>`

    sec.innerHTML = list.length === 0 ? emptyHtml : `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Название</th>
              <th>Счёт</th>
              <th class="num">Сумма</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map(it => `
              <tr data-id="${it.id}">
                <td>${it.date || ''}</td>
                <td>${escapeHtml(it.name)}</td>
                <td>${escapeHtml(accountName(accounts, it.accountId))}</td>
                <td class="num ${it.amount < 0 ? 'num-expense' : 'num-income'}">${rub(it.amount)}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm" data-action="edit" data-id="${it.id}" title="Редактировать">✎</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" data-id="${it.id}" title="Удалить">×</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    // ---------- 6. Обработчики edit/delete ----------
    // После каждой перерисовки таблицы — единый forEach по data-action.
    sec.querySelectorAll('[data-action="edit"]').forEach(b => {
      b.addEventListener('click', () => {
        const it = list.find(x => x.id === b.dataset.id)
        if (it) openResourceForm(root, accounts, it)
      })
    })
    sec.querySelectorAll('[data-action="delete"]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить запись?')) return
        try {
          await api.del(`/api/RESOURCE/${b.dataset.id}`)
          toast('Удалено', 'success')
          loadAndRenderTable()
        } catch (e) { toast(e.message, 'error') }
      })
    })

    // Кнопка «Сбросить фильтры» в empty-state
    const emptyReset = sec.querySelector('#empty-reset')
    if (emptyReset) {
      emptyReset.addEventListener('click', () => {
        for (const k of Object.keys(filters)) filters[k] = ''
        root.querySelectorAll('[data-filter]').forEach(el => { el.value = '' })
        const barReset = root.querySelector('#filters-bar-reset')
        if (barReset) barReset.style.display = 'none'
        loadAndRenderTable()
      })
    }
  }

  // ---------- 7. Тулбар с фильтрами ----------
  // .page-toolbar--filters — кнопка «Добавить» идёт СРАЗУ за фильтрами,
  // не прижата к правому краю (как на «Операциях»).
  root.innerHTML = `
    <div class="page-toolbar page-toolbar--filters">
      <div class="filters-bar filters-bar--inline">
        <label class="filter"><span>Дата от</span><input type="date" data-filter="from" value="${escapeHtml(filters.from)}"></label>
        <label class="filter"><span>Дата до</span><input type="date" data-filter="to" value="${escapeHtml(filters.to)}"></label>
        <label class="filter"><span>Счёт</span>
          <select data-filter="accountId">
            <option value="">Все</option>
            ${accounts.map(a => `<option value="${escapeHtml(a.id)}"${filters.accountId === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter"><span>Поиск</span><input type="text" data-filter="q" placeholder="по названию, комментарию…" value="${escapeHtml(filters.q)}"></label>
        <button class="btn btn-sm" id="filters-bar-reset"${Object.values(filters).some(v => v) ? '' : ' style="display:none"'}>Сбросить</button>
        <button class="btn btn-primary" id="add-RESOURCE">+ Добавить</button>
      </div>
    </div>
  `

  document.getElementById('add-RESOURCE').addEventListener('click', () =>
    openResourceForm(root, accounts, null))

  // ---------- 8. Обработчики фильтров ----------
  // Debounce на текстовом поиске, чтобы не заваливать backend.
  const debouncedQ = debounce(() => loadAndRenderTable(), 300)
  root.querySelectorAll('[data-filter]').forEach(el => {
    const key = el.dataset.filter
    const ev = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change'
    el.addEventListener(ev, () => {
      filters[key] = el.value
      const barReset = document.getElementById('filters-bar-reset')
      if (barReset) barReset.style.display = Object.values(filters).some(v => v) ? '' : 'none'
      key === 'q' ? debouncedQ() : loadAndRenderTable()
    })
  })

  const barReset = root.querySelector('#filters-bar-reset')
  if (barReset) {
    barReset.addEventListener('click', () => {
      for (const k of Object.keys(filters)) filters[k] = ''
      root.querySelectorAll('[data-filter]').forEach(el => { el.value = '' })
      barReset.style.display = 'none'
      loadAndRenderTable()
    })
  }

  // ---------- 9. Первая отрисовка ----------
  await loadAndRenderTable()
}

// =============================================================================
// Модальная форма (create/edit)
// =============================================================================

function openResourceForm(root, accounts, item) {
  const isEdit = !!item

  openModal({
    title: isEdit ? 'Редактировать' : 'Новая запись',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',

    // Поля декларативно — modal.js сам построит форму.
    // Доступные типы: text, number, date, select, textarea, checkbox,
    // toggle, combobox, category-select, color (см. modal.js:19-122).
    fields: [
      {
        name: 'name', label: 'Название', type: 'text', required: true,
        placeholder: 'Например: Отпуск 2027',
        value: item?.name
      },
      {
        name: 'accountId', label: 'Счёт', type: 'select', required: true,
        value: item?.accountId,
        options: accounts.map(a => ({ value: a.id, label: a.name }))
      },
      {
        name: 'amount', label: 'Сумма (₽)', type: 'number', required: true,
        step: '0.01', placeholder: '0',
        value: item ? item.amount / 100 : undefined,
        // Минимум проверяется в modal.js (если задан f.min).
        min: 0
      },
      {
        name: 'date', label: 'Дата', type: 'date', required: true,
        value: item?.date || todayIso()
      },
      { name: 'comment', label: 'Комментарий', type: 'textarea', value: item?.comment }
    ],

    // onMount — доп. логика после построения формы (например, динамическое
    // скрытие полей). Если не нужно — просто не передавай.
    // onMount: (dialog) => { ... },

    // onSubmit — async; throw → modal.js покажет .form-error.
    onSubmit: async (data) => {
      // Суммы в БД — копейки (integer). Переводим рубли → копейки.
      const body = {
        name: data.name,
        accountId: data.accountId,
        amount: Math.round(Number(data.amount) * 100),
        date: data.date,
        comment: data.comment || ''
      }

      try {
        if (isEdit) await api.patch(`/api/RESOURCE/${item.id}`, body)
        else await api.post('/api/RESOURCE', body)
        toast(isEdit ? 'Сохранено' : 'Создано', 'success')
        render(root)  // полный перерендер вьюхи
      } catch (e) { throw e }
    }
  })
}

// =============================================================================
// Утилиты (локальные)
// =============================================================================

function accountName(accounts, id) {
  return accounts.find(a => a.id === id)?.name || '—'
}

function debounce(fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

// =============================================================================
// Прежде чем использовать (НАЙДИ и ЗАМЕНИ):
// =============================================================================
//
//   RESOURCE            → имя ресурса в URL, например "goals"
//   /api/RESOURCE       → реальный эндпоинт
//   "Название"           → понятный заголовок
//   "имя колонки"        → реальные поля из API
//   $rub()               → правильный форматтер для колонки
//   $icon                → если хочешь иконку в сайдбаре (FA 4)
//
// ВАЖНО — контракт (см. AGENTS.md §6):
//   - package.json без изменений (нет npm install)
//   - styles.css без изменений (нет новых классов)
//   - все пользовательские значения в innerHTML — через escapeHtml()
//   - hover/active/focus на кнопках (это уже в styles.css)
//   - после save/delete — render(root) или loadAndRenderTable()
//   - если добавил НОВЫЙ класс в styles.css — обнови DESIGN.md §3 и SKILLS.md
