import { api, rub, toast, todayIso, escapeHtml } from '../api.js'
import { openModal } from '../ui/modal.js'
import { categoryIconHTML } from '../data/categoryIcons.js'
import { transactionTypeKey, transactionTypeLabel, transactionSignedAmount } from '../data/transactionTypes.js'

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
      <div class="empty-actions"><button class="btn btn-primary" id="add-acc">+ Добавить счёт</button></div>
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
          <div class="empty-actions"><button class="btn btn-sm" id="empty-reset">Сбросить фильтры</button></div>
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
                <td class="date-cell">${t.date}</td>
                <td>${accountName(t.accountId)}</td>
                <td>${categoryName(t.categoryId)}</td>
                <td><span class="badge badge-${transactionTypeKey(t)}">${transactionTypeLabel(t)}</span></td>
                <td class="num num-${transactionTypeKey(t)}">${transactionSignedAmount(t) > 0 ? '+' : ''}${rub(transactionSignedAmount(t))}</td>
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
        if (txItem) openTransactionForm(root, accounts, categories, txItem, tx).catch(e => toast(e.message, 'error'))
      })
    })

    tableSection.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const txItem = tx.find(t => t.id === btn.dataset.id)
        if (!txItem) return

        // Перевод — две ноги: удалять половину нельзя. Пару ищем не только в
        // загруженном списке (он может быть отфильтрован по счёту/типу/поиску,
        // и второй ноги в нём нет), но и догрузкой по externalRef.
        if (txItem.type === 'transfer') {
          const { outLeg, inLeg, failed } = await resolveTransferPair(txItem, tx)
          if (failed || !outLeg || !inLeg) {
            toast('Не удалось найти вторую половину перевода — обновите список', 'error')
            return
          }
          if (!confirm('Удалить перевод (обе половины)?')) return
          // Удаляем парную ногу первой: если вторая не удалится, восстановим
          // парную — «полу-перевод» не оставляем.
          const other = txItem.id === outLeg.id ? inLeg : outLeg
          try {
            await api.del(`/api/transactions/${other.id}`)
            try {
              await api.del(`/api/transactions/${txItem.id}`)
            } catch (e) {
              try { await api.post('/api/transactions', pairCreateBody(other)) }
              catch (compErr) { console.error('transfer delete compensation failed:', compErr) }
              throw e
            }
            toast('Удалено', 'success')
            loadAndRenderTable()
          } catch (e) { toast(e.message, 'error') }
          return
        }

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
      cell.innerHTML = `<input type="text" class="comment-input" value="${escapeHtml(current)}">`
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
  document.getElementById('add-tx').addEventListener('click', () => {
    openTransactionForm(root, accounts, categories, null).catch(e => toast(e.message, 'error'))
  })

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

// --- Перевод: поиск пары и вспомогательные тела запросов ---

// Ищет обе половины перевода: сначала в уже загруженном списке, затем — если
// externalRef есть, а второй ноги в списке нет (список отфильтрован по счёту/
// типу/поиску) — догружает по externalRef. `failed` означает, что догрузка
// упала: в этом случае нельзя менять одну ногу вслепую.
async function resolveTransferPair(txItem, allTx) {
  const result = { outLeg: null, inLeg: null, rows: [], failed: false }
  if (!txItem || txItem.type !== 'transfer') return result
  const ref = txItem.externalRef
  const source = Array.isArray(allTx) ? allTx : []
  let rows = source.filter(r => r.type === 'transfer' && ((ref && r.externalRef === ref) || r.id === txItem.id))
  if (ref && rows.length < 2) {
    try {
      const fetched = await api.get('/api/transactions?externalRef=' + encodeURIComponent(ref) + '&limit=10')
      const byId = new Map(rows.map(r => [r.id, r]))
      for (const r of fetched) if (r && r.type === 'transfer') byId.set(r.id, r)
      rows = [...byId.values()]
    } catch (e) {
      result.failed = true
    }
  }
  result.rows = rows
  Object.assign(result, assignTransferLegs(rows, txItem))
  return result
}

// Раскладывает строки по слотам out/in. Строка, из которой открыли форму, обязана
// попасть в слот; строки без transferDirection (легаси) занимают свободный слот —
// так мы правим их, а не создаём дубль рядом.
function assignTransferLegs(rows, txItem) {
  let outLeg = rows.find(r => r.transferDirection === 'out') || null
  let inLeg = rows.find(r => r.transferDirection === 'in') || null
  const assigned = new Set([outLeg?.id, inLeg?.id].filter(Boolean))
  if (!assigned.has(txItem.id)) {
    if (!outLeg) { outLeg = txItem; assigned.add(txItem.id) }
    else if (!inLeg) { inLeg = txItem; assigned.add(txItem.id) }
  }
  for (const r of rows) {
    if (assigned.has(r.id)) continue
    if (!outLeg) { outLeg = r; assigned.add(r.id) }
    else if (!inLeg) { inLeg = r; assigned.add(r.id) }
  }
  return { outLeg, inLeg }
}

// Тело PATCH, возвращающее ногу к исходному состоянию (best-effort компенсация
// при сбое второго шага парной мутации).
function restoreBody(t) {
  return {
    accountId: t.accountId,
    type: t.type,
    amount: t.amount,
    date: t.date,
    comment: t.comment || '',
    categoryId: t.categoryId ?? null,
    source: t.source,
    externalRef: t.externalRef ?? null,
    transferDirection: t.transferDirection ?? null
  }
}

// Тело POST, восстанавливающее удалённую ногу с тем же id.
function pairCreateBody(t) {
  return {
    id: t.id,
    accountId: t.accountId,
    type: t.type,
    transferDirection: t.transferDirection ?? null,
    amount: t.amount,
    currency: t.currency || 'RUB',
    categoryId: t.categoryId ?? null,
    date: t.date,
    comment: t.comment || '',
    source: t.source || 'manual',
    externalRef: t.externalRef ?? null
  }
}

// Опции <select> счёта: если текущий счёт (value) не попал в activeOptions —
// например, он архивный или удалён — добавляем его из полного `accounts`.
// Иначе <select> молча выбрал бы первый активный счёт и сохранил ногу на чужой.
function accountSelectOptions(baseOptions, accounts, value, needsPlaceholder) {
  let options = baseOptions
  if (value) {
    const has = baseOptions.some(o => String(o.value) === String(value))
    if (!has) {
      const acc = (accounts || []).find(a => String(a.id) === String(value))
      if (acc) {
        const suffix = acc.archived ? ' (архив)' : ''
        options = [{
          value: acc.id,
          label: `${acc.name}${suffix} — ${rub(acc.currentBalance ?? acc.balance, { html: false })}`
        }, ...baseOptions]
      }
    }
  }
  // Placeholder: нет значения вовсе (правка перевода без пары) или значение
  // валидно, но счёт не найден — вместо чужого первого счёта показываем «выберите».
  const resolved = value && options.some(o => String(o.value) === String(value))
  if (!resolved && (needsPlaceholder || value)) {
    return [{ value: '', label: '— выберите счёт —' }, ...options]
  }
  return options
}

export async function openTransactionForm(root, accounts, categories, tx, allTx) {
  if (!accounts || accounts.length === 0) {
    toast('Сначала создайте счёт', 'error')
    return
  }
  const isEdit = !!tx
  const activeAccounts = accounts.filter(a => !a.archived)
  // label уходит в <option>: браузер показывает только текст, HTML-разметка
  // (включая <span class="amt-neg">) отображалась бы как сырой код. Передаём
  // { html: false } чтобы rub() отдал чистый текст.
  const accountOptions = activeAccounts.map(a => ({ value: a.id, label: `${a.name} — ${rub(a.currentBalance ?? a.balance, { html: false })}` }))

  // Перевод — две строки type='transfer' с общим externalRef: нога 'out' (источник)
  // и 'in' (получатель). У отдельной строки нет своего targetAccountId, поэтому
  // без поиска пары форма показывала первый счёт («чужой»). resolveTransferPair
  // ищет обе ноги и сам догружает их по externalRef, когда список отфильтрован.
  const isTransferEdit = isEdit && tx.type === 'transfer'
  let outLeg = null
  let inLeg = null
  let pairRows = []
  let pairFetchFailed = false
  if (isTransferEdit) {
    const resolved = await resolveTransferPair(tx, allTx)
    outLeg = resolved.outLeg
    inLeg = resolved.inLeg
    pairRows = resolved.rows
    pairFetchFailed = resolved.failed
  }

  const sourceValue = isTransferEdit ? (outLeg?.accountId || '') : tx?.accountId
  const targetValue = isTransferEdit ? (inLeg?.accountId || '') : tx?.targetAccountId
  // Текущий счёт обязан быть в <option>, даже если он архивный: иначе <select>
  // молча выберет первый активный и при сохранении нога уедет на чужой счёт.
  const sourceAccountOptions = accountSelectOptions(accountOptions, accounts, sourceValue, isTransferEdit)
  const targetAccountOptions = accountSelectOptions(accountOptions, accounts, targetValue, isTransferEdit)

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
      value: sourceValue,
      options: sourceAccountOptions,
      visibleIf: v => v.type !== 'transfer' ? true : true // всегда виден
    },
    {
      // Целевой счёт — только для перемещения. Метка динамическая: «На счёт».
      name: 'targetAccountId', label: 'На счёт', type: 'select', required: true,
      value: targetValue,
      options: targetAccountOptions,
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
      // Исходная строка выписки — только у импортированных операций (rawSource
      // есть лишь после импорта; у ручных его нет). Показываем сворачиваемым
      // блоком read-only, чтобы можно было сверить разбор после записи.
      // Вставляем сами через onMount (createElement + textContent) — modal.js
      // не трогаем и новых типов полей не добавляем; текст — textContent, а не
      // innerHTML, чтобы исключить XSS из банковской строки.
      if (tx && tx.rawSource) {
        const form = dialog.querySelector('.modal-form')
        const actions = form && form.querySelector('.modal-actions')
        if (form && actions) {
          const details = document.createElement('details')
          details.className = 'raw-source-block'
          const summary = document.createElement('summary')
          summary.textContent = 'Исходные данные из выписки'
          const pre = document.createElement('pre')
          pre.className = 'raw-source-text'
          pre.textContent = tx.rawSource
          details.appendChild(summary)
          details.appendChild(pre)
          form.insertBefore(details, actions)
        }
      }
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
        // Перемещение: две ноги type='transfer' с направлением (out — источник,
        // in — получатель). Так балансы счетов двигаются, как у импортных
        // переводов, а фильтр «Перемещение» и дашборд «Доход/Расход» не путают
        // перевод с доходом/расходом. Категория у перевода не задаётся.
        if (!body.targetAccountId) throw new Error('Укажите счёт назначения')
        if (body.targetAccountId === body.accountId) throw new Error('Счета должны различаться')
        if (body.amount === null || body.amount <= 0) throw new Error('Сумма должна быть больше нуля')
        const amount = Math.round(Number(body.amount) * 100)
        const common = {
          amount,
          date: body.date,
          comment: body.comment || '',
          source: body.source || 'manual',
          categoryId: null
        }
        const outBody = { ...common, type: 'transfer', transferDirection: 'out', accountId: body.accountId }
        const inBody = { ...common, type: 'transfer', transferDirection: 'in', accountId: body.targetAccountId }

        // --- Создание ручного перевода ---
        if (!isEdit) {
          // Пара ручного перевода получает общий externalRef, иначе при
          // последующей правке ноги невозможно связать и форма покажет чужой счёт.
          const externalRef = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const createdOut = await api.post('/api/transactions', { ...outBody, externalRef })
          try {
            await api.post('/api/transactions', { ...inBody, externalRef })
          } catch (e) {
            // Компенсация: не оставляем созданную половину пары висеть.
            try { await api.del(`/api/transactions/${createdOut.id}`) }
            catch (compErr) { console.error('transfer create compensation failed:', compErr) }
            throw e
          }
          toast('Перемещение создано', 'success')
          render(root)
          return
        }

        // --- Правка существующего перевода: обе ноги, с компенсацией ---
        if (isTransferEdit) {
          if (pairFetchFailed) throw new Error('Не удалось загрузить вторую половину перевода — попробуйте ещё раз')
          const ref = tx.externalRef
          if (!ref) {
            throw new Error('Не найдена вторая половина перевода — откройте список с обеими ногами')
          }
          // Строки без направления (легаси) правим, а не создаём заново: иначе
          // рядом с существующей ногой появился бы дубль.
          const unassigned = pairRows.filter(r => r.id !== outLeg?.id && r.id !== inLeg?.id)
          const applied = []  // { id, original } — ноги, которые надо вернуть при сбое
          const created = []  // id созданных ног — их надо удалить при сбое
          try {
            for (const [slot, legBody] of [['out', outBody], ['in', inBody]]) {
              const target = (slot === 'out' ? outLeg : inLeg) || unassigned.shift() || null
              if (target) {
                applied.push({ id: target.id, original: restoreBody(target) })
                await api.patch(`/api/transactions/${target.id}`, legBody)
              } else {
                const row = await api.post('/api/transactions', { ...legBody, externalRef: ref })
                created.push(row.id)
              }
            }
          } catch (e) {
            // Best-effort компенсация: возвращаем изменённые ноги к исходным
            // значениям и удаляем созданные, чтобы пара не рассогласовалась.
            for (const a of applied) {
              try { await api.patch(`/api/transactions/${a.id}`, a.original) }
              catch (compErr) { console.error('transfer edit compensation failed:', compErr) }
            }
            for (const id of created) {
              try { await api.del(`/api/transactions/${id}`) }
              catch (compErr) { console.error('transfer edit compensation failed:', compErr) }
            }
            throw e
          }
          toast('Перемещение обновлено', 'success')
          render(root)
          return
        }

        // --- Смена типа обычной операции на «Перемещение» ---
        // Текущая строка становится ногой out (PATCH), для получателя создаётся
        // нога in с общим externalRef. Текущую строку НЕ дублируем: иначе
        // получался дубль перевода и та же строка оставалась расходом/доходом.
        const ref = tx.externalRef || `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const original = restoreBody(tx)
        try {
          await api.patch(`/api/transactions/${tx.id}`, { ...outBody, externalRef: ref })
          await api.post('/api/transactions', { ...inBody, externalRef: ref })
        } catch (e) {
          try { await api.patch(`/api/transactions/${tx.id}`, original) }
          catch (compErr) { console.error('transfer convert compensation failed:', compErr) }
          throw e
        }
        toast('Перемещение создано', 'success')
        render(root)
        return
      }

      // --- Расход/доход: создание или правка ---
      // Если правим перевод и меняем тип на расход/доход — удаляем парную ногу,
      // иначе останется «полу-перевод» с висящей половиной.
      let pairLeg = null
      if (isTransferEdit) {
        if (pairFetchFailed) throw new Error('Не удалось загрузить вторую половину перевода — попробуйте ещё раз')
        if (!outLeg || !inLeg) throw new Error('Не найдена вторая половина перевода — обновите список')
        pairLeg = outLeg.id === tx.id ? inLeg : outLeg
        // Направление перевода у расхода/дохода не имеет смысла — очищаем.
        body.transferDirection = null
      }
      if (!body.categoryId) delete body.categoryId
      if (body.amount === null || body.amount <= 0) throw new Error('Сумма должна быть больше нуля')
      body.amount = Math.round(Number(body.amount) * 100)
      try {
        if (isEdit) {
          const original = restoreBody(tx)
          await api.patch(`/api/transactions/${tx.id}`, body)
          if (pairLeg) {
            try {
              await api.del(`/api/transactions/${pairLeg.id}`)
            } catch (e) {
              // DELETE парной упал — возвращаем текущую ногу к исходному виду.
              try { await api.patch(`/api/transactions/${tx.id}`, original) }
              catch (compErr) { console.error('transfer→expense compensation failed:', compErr) }
              throw e
            }
          }
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


