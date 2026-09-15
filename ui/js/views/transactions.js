import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'
import { categoryIconHTML } from '../data/categoryIcons.js'

export async function render(root) {
  const [accounts, categories] = await Promise.all([
    api.get('/api/accounts'),
    api.get('/api/categories')
  ])

  const accountName = id => accounts.find(a => a.id === id)?.name || '—'
  const categoryName = id => categories.find(c => c.id === id)?.name || ''

  if (accounts.length === 0) {
    root.innerHTML = `<div class="empty">
      <div class="empty-title">Начните со счёта</div>
      Создайте хотя бы один счёт, чтобы добавлять операции.
      <div style="margin-top:16px"><button class="btn btn-primary" id="add-acc">+ Добавить счёт</button></div>
    </div>`
    document.getElementById('add-acc').addEventListener('click', () => openAccountForm(root, null))
    return
  }

  // Состояние фильтров в замыкании. Каждое изменение → запрос к API + перерисовка таблицы.
  const filters = { from: '', to: '', categoryId: '', type: '', accountId: '', q: '' }

  // Начальные значения из hash (?from=…&to=…&type=…&accountId=…).
  // Используется дашбордом: карточки «Доход/Расход сегодня» ведут сюда с уже
  // выставленными фильтрами, чтобы пользователь сразу видел операции за сегодня.
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

  // Строим query string для /api/transactions из текущих фильтров.
  function buildQuery() {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v)
    }
    // backend принимает limit; по умолчанию 500 — для большинства фильтров хватит.
    params.set('limit', '500')
    return `?${params.toString()}`
  }

  // Загружаем операции с учётом фильтров и рендерим таблицу.
  async function loadAndRenderTable() {
    let tx
    try {
      tx = await api.get(`/api/transactions${buildQuery()}`)
    } catch (e) {
      toast('Не удалось загрузить операции: ' + e.message, 'error')
      return
    }

    const tableSection = root.querySelector('.table-section') || (() => {
      const div = document.createElement('div')
      div.className = 'table-section'
      root.appendChild(div)
      return div
    })()

    // Любой фильтр активен? — покажем empty-state с подсказкой сбросить,
    // даже если backend вернул 0 записей.
    const anyFilterActive = Object.values(filters).some(v => v)
    const emptyHtml = anyFilterActive
      ? `<div class="empty">
          <div class="empty-title">Нет операций по фильтру</div>
          Попробуйте сбросить фильтры или изменить условия.
          <div style="margin-top:12px"><button class="btn btn-sm" id="empty-reset">Сбросить фильтры</button></div>
        </div>`
      : `<div class="empty">
          <div class="empty-title">Операций пока нет</div>
          Нажми «+ Добавить операцию» или заполни через CLI:<br>
          <code>fin agent add-transaction --account "Tinkoff Black" --type expense --amount 1500 --category "Продукты" --comment "Магнит"</code>
        </div>`

    const tableHtml = tx.length === 0 ? emptyHtml : `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Счёт</th>
              <th>Категория</th>
              <th>Тип</th>
              <th class="num">Сумма</th>
              <th>Комментарий / Merchant <span class="hint-warn" style="font-weight:normal">(двойной клик для правки)</span></th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            ${tx.map(t => `
              <tr data-id="${t.id}">
                <td>${t.date}</td>
                <td>${accountName(t.accountId)}</td>
                <td>${categoryName(t.categoryId)}</td>
                <td><span class="badge badge-${t.type}">${t.type === 'expense' ? 'Расход' : 'Доход'}</span></td>
                <td class="num num-${t.type}">${t.type === 'income' ? '+' : ''}${rub(t.type === 'expense' ? -t.amount : t.amount)}</td>
                <td class="comment-cell"
                    data-id="${t.id}"
                    data-comment="${escapeHtml(t.comment || '')}"
                    title="Двойной клик — редактировать">${escapeHtml(t.comment || '')}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm" data-action="edit" data-id="${t.id}" title="Редактировать">✎</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" data-id="${t.id}" title="Удалить">×</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`

    tableSection.innerHTML = tableHtml

    // Обработчики edit/delete — после каждой перерисовки таблицы.
    tableSection.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const txItem = tx.find(t => t.id === btn.dataset.id)
        if (txItem) openTransactionForm(root, accounts, categories, txItem)
      })
    })

    tableSection.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить операцию?')) return
        try {
          await api.del(`/api/transactions/${btn.dataset.id}`)
          toast('Удалено', 'success')
          loadAndRenderTable()
        } catch (e) { toast(e.message, 'error') }
      })
    })

    // Inline-редактирование комментария: двойной клик → input.
    // Enter / blur — сохранить через PATCH. Escape — отменить.
    tableSection.querySelectorAll('.comment-cell').forEach(cell => {
      cell.addEventListener('dblclick', () => startCommentEdit(cell))
    })

    function startCommentEdit(cell) {
      const id = cell.dataset.id
      const current = cell.dataset.comment
      if (cell.querySelector('input')) return  // уже редактируется
      cell.innerHTML = `<input type="text" class="comment-input" value="${escapeHtml(current)}" style="width:100%;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;">`
      const input = cell.querySelector('input')
      input.focus()
      input.select()
      let finished = false
      const commit = async (save) => {
        if (finished) return
        finished = true
        const newVal = input.value.trim()
        if (save && newVal === current) {
          // Ничего не изменилось — просто перерисовать.
          renderCellText(cell, current)
          return
        }
        if (!save || !newVal) {
          renderCellText(cell, current)
          return
        }
        try {
          const updated = await api.patch(`/api/transactions/${id}`, { comment: newVal })
          renderCellText(cell, updated.comment || '')
          cell.dataset.comment = updated.comment || ''
          toast('Комментарий сохранён', 'success')
        } catch (e) {
          toast('Не удалось сохранить: ' + e.message, 'error')
          renderCellText(cell, current)
        }
      }
      input.addEventListener('blur', () => commit(true))
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur() }
        if (e.key === 'Escape') { e.preventDefault(); commit(false) }
      })
    }
    function renderCellText(cell, text) {
      cell.innerHTML = escapeHtml(text || '')
    }

    const emptyReset = tableSection.querySelector('#empty-reset')
    if (emptyReset) {
      emptyReset.addEventListener('click', () => {
        for (const k of Object.keys(filters)) filters[k] = ''
        // Подменить значения в полях фильтр-бара
        root.querySelectorAll('[data-filter]').forEach(el => {
          const key = el.dataset.filter
          if (el.tagName === 'INPUT') el.value = ''
          else if (el.tagName === 'SELECT') el.value = ''
        })
        // Спрятать саму кнопку «Сбросить фильтры» в баре, если она была
        const barReset = root.querySelector('#filters-bar-reset')
        if (barReset) barReset.style.display = 'none'
        loadAndRenderTable()
      })
    }
  }

  // Тулбар: фильтры и кнопка «Добавить» — в одной строке, кнопка сразу за фильтрами
  // (в том же стиле, что строка итогов на «Подписках»).
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
        <label class="filter"><span>Категория</span>
          <select data-filter="categoryId">
            <option value="">Все</option>
            ${categories.map(c => `<option value="${escapeHtml(c.id)}"${filters.categoryId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter"><span>Тип</span>
          <select data-filter="type">
            <option value="">Все</option>
            <option value="expense"${filters.type === 'expense' ? ' selected' : ''}>Расход</option>
            <option value="income"${filters.type === 'income' ? ' selected' : ''}>Доход</option>
            <option value="transfer"${filters.type === 'transfer' ? ' selected' : ''}>Перемещение</option>
          </select>
        </label>
        <label class="filter"><span>Поиск</span><input type="text" data-filter="q" placeholder="счёт, категория, сумма, комментарий…" value="${escapeHtml(filters.q)}"></label>
        <button class="btn btn-sm" id="filters-bar-reset"${Object.values(filters).some(v => v) ? '' : ' style="display:none"'}>Сбросить</button>
        <button class="btn btn-primary" id="add-tx">+ Добавить операцию</button>
      </div>
    </div>
  `
  document.getElementById('add-tx').addEventListener('click', () => openTransactionForm(root, accounts, categories, null))

  // Навешиваем обработчики на фильтры
  const debouncedQ = debounce(() => loadAndRenderTable(), 300)
  root.querySelectorAll('[data-filter]').forEach(el => {
    const key = el.dataset.filter
    const event = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change'
    el.addEventListener(event, () => {
      filters[key] = el.value
      // Показать/спрятать кнопку сброса
      const barReset = root.querySelector('#filters-bar-reset')
      if (barReset) barReset.style.display = Object.values(filters).some(v => v) ? '' : 'none'
      if (key === 'q') debouncedQ()
      else loadAndRenderTable()
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

  await loadAndRenderTable()
}

// Не заваливать бэкенд на каждом нажатии клавиши в поиске.
function debounce(fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export function openTransactionForm(root, accounts, categories, tx) {
  if (!accounts || accounts.length === 0) {
    toast('Сначала создайте счёт', 'error')
    return
  }
  const isEdit = !!tx
  const activeAccounts = accounts.filter(a => !a.archived)
  const accountOptions = activeAccounts.map(a => ({ value: a.id, label: `${a.name} — ${rub(a.currentBalance ?? a.balance)}` }))

  // Поля формы: type (toggle), amount, accountId, targetAccountId (только для transfer),
  // categoryId (только для expense/income), date, comment.
  // Поля с visibleIf показаны только при соответствующем типе.
  const fields = [
    {
      name: 'type', label: 'Тип', type: 'toggle', required: true,
      value: tx?.type || 'expense',
      options: [
        { value: 'expense', label: 'Расход' },
        { value: 'income', label: 'Доход' },
        { value: 'transfer', label: 'Перемещение' }
      ]
    },
    { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, placeholder: '1500', step: '0.01', kopecks: true,
      value: tx ? tx.amount / 100 : undefined },
    {
      name: 'accountId', label: 'Со счёта', type: 'select', required: true,
      value: tx?.accountId,
      options: accountOptions,
      visibleIf: v => v.type !== 'transfer' ? true : true // всегда виден
    },
    {
      // Целевой счёт — только для перемещения. Метка динамическая: «На счёт».
      name: 'targetAccountId', label: 'На счёт', type: 'select', required: true,
      value: tx?.targetAccountId,
      options: accountOptions,
      visibleIf: v => v.type === 'transfer'
    },
    {
      name: 'categoryId', label: 'Категория', type: 'category-select',
      value: tx?.categoryId || '',
      options: [
        { value: '', label: '— без категории —', html: '— без категории —' },
        ...categories.map(c => ({
          value: c.id,
          label: c.name,
          html: `${categoryIconHTML(c.icon)} ${escapeHtml(c.name)}`
        }))
      ],
      visibleIf: v => v.type === 'expense' || v.type === 'income'
    },
    { name: 'date', label: 'Дата', type: 'date', required: true, value: tx?.date || todayIso() },
    { name: 'comment', label: 'Комментарий', type: 'text', placeholder: 'Магнит', value: tx?.comment }
  ]

  openModal({
    title: isEdit ? 'Редактировать операцию' : 'Новая операция',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields,
    onMount: (dialog) => {
      // Динамическое скрытие/показ полей в зависимости от текущего значения type.
      // Навешиваем обработчик на change для [name="type"] (radio сегментов).
      const applyVisibility = () => {
        const typeEl = dialog.querySelector('[name="type"]')
        const current = {}
        for (const f of fields) {
          const el = dialog.querySelector(`[name="${f.name}"]`)
          if (!el) continue
          current[f.name] = f.type === 'checkbox' ? el.checked : el.value
        }
        for (const f of fields) {
          if (!f.visibleIf) continue
          const fieldEl = el => el.closest('.form-field')
          const el = dialog.querySelector(`[name="${f.name}"]`)
          if (!el) continue
          const wrapper = fieldEl(el)
          if (!wrapper) continue
          wrapper.style.display = f.visibleIf(current) ? '' : 'none'
        }
        // Подменить label «Со счёта»/«Счёт» в зависимости от типа
        const accLabel = dialog.querySelector('label[for^="f-accountId-"]')
        if (accLabel) {
          accLabel.innerHTML = (current.type === 'income' ? 'На счёт' : 'Со счёта') +
            (accLabel.innerHTML.includes('*') ? ' <span style="color:var(--danger)">*</span>' : '')
        }
      }
      dialog.querySelectorAll('[data-toggle-option]').forEach(r => r.addEventListener('change', applyVisibility))
      applyVisibility()
    },
    onSubmit: async (data) => {
      const body = { ...data, source: tx?.source || 'manual' }
      if (body.type === 'transfer') {
        // Перемещение: создаём пару — расход с исходного и приход на целевой.
        // Связываем через transferGroup, чтобы потом можно было удалить/править парой.
        if (!body.targetAccountId) throw new Error('Укажите счёт назначения')
        if (body.targetAccountId === body.accountId) throw new Error('Счета должны различаться')
        delete body.targetAccountId // поле не идёт в API как есть, обработаем ниже
        body.source = 'manual'
        const transferGroup = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const base = {
          amount: body.amount,
          date: body.date,
          comment: body.comment || '',
          source: 'transfer',
          transferGroup
        }
        const expense = { ...base, type: 'expense', accountId: body.accountId, categoryId: null }
        const income = { ...base, type: 'income', accountId: body.targetAccountId, categoryId: null }
        try {
          await api.post('/api/transactions', expense)
          await api.post('/api/transactions', income)
          toast('Перемещение создано', 'success')
        } catch (e) { throw e }
        render(root)
        return
      }
      if (!body.categoryId) delete body.categoryId
      if (body.amount === null || body.amount <= 0) throw new Error('Сумма должна быть больше нуля')
      body.amount = Math.round(Number(body.amount) * 100)
      try {
        if (isEdit) {
          await api.patch(`/api/transactions/${tx.id}`, body)
          toast('Операция обновлена', 'success')
        } else {
          await api.post('/api/transactions', body)
          toast('Операция добавлена', 'success')
        }
        render(root)
      } catch (e) { throw e }
    }
  })
}

function openAccountForm(root, account) {
  const isEdit = !!account
  openModal({
    title: isEdit ? 'Редактировать счёт' : 'Новый счёт',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields: [
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Tinkoff Black', value: account?.name },
      {
        name: 'type', label: 'Тип', type: 'select', required: true,
        options: [
          { value: 'debit', label: 'Дебетовая карта' },
          { value: 'credit', label: 'Кредитная карта' },
          { value: 'card', label: 'Карта' },
          { value: 'savings', label: 'Накопительный' }
        ]
      },
      { name: 'bank', label: 'Банк', type: 'text', placeholder: 'tinkoff' },
      { name: 'balance', label: 'Начальный баланс (₽)', type: 'number', placeholder: '0', step: '0.01', value: 0 },
      { name: 'currency', label: 'Валюта', type: 'text', value: 'RUB' }
    ],
    onSubmit: async (data) => {
      if (data.balance === null) data.balance = 0
      await api.post('/api/accounts', data)
      toast('Счёт создан', 'success')
      render(root)
    }
  })
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

