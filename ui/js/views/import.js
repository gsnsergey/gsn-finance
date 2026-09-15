// Импорт банковских выписок (Альфа): загрузка PDF, превью-таблица,
// inline-редактирование счёта и категории, импорт выбранного.
//
// UX:
//   1. Пользователь выбирает PDF.
//   2. POST /api/import/alfa/preview → { operations, totals }.
//   3. Таблица: чекбокс | дата | MCC | merchant | маска | счёт (select) |
//      категория (select) | сумма | комментарий. Уже импортированные —
//      отмечены и disabled. Если маска не привязана к счёту — счёт «неизвестен»,
//      пользователь выбирает вручную.
//   4. Категория подставляется из import_rules (suggestedCategoryId +
//      matchedRule). Если ничего не нашлось — пустой select.
//   5. Кнопка «Импортировать выбранные» → POST /api/transactions/import.
//      Сводка: «N создано, M уже было, K пропущено/ошибок».
//
// Inline-правка категории без правила: при выборе категории вручную
// появляется чекбокс «Сохранить как правило для MCC …» — правило создаётся
// POST /api/import-rules перед записью операций (если отмечено).

import { api, rub, toast } from '../api.js'

function escapeHtml(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch])
}

// POST бинарного файла (PDF) на /api/import/alfa/preview.
// Отдельный метод, потому что стандартный api.post всегда Content-Type: json.
async function postPdf(path, file) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const msg = (data && data.message) || (data && data.error) || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

export async function render(root) {
  // Состояние страницы в замыкании. Один источник истины для UI.
  const state = {
    accounts: [],
    categories: [],
    file: null,
    preview: null,           // { operations, totals } от /api/import/alfa/preview
    // Локальные правки пользователя: rowId -> { accountId, categoryId, saveAsRule }
    edits: new Map(),
    loading: false
  }

  // Загружаем справочники (для select'ов счёта и категории) заранее.
  try {
    const [accounts, categories] = await Promise.all([
      api.get('/api/accounts'),
      api.get('/api/categories')
    ])
    state.accounts = accounts.filter(a => !a.archived)
    state.categories = categories.filter(c => !c.archived)
  } catch (e) {
    toast('Не удалось загрузить справочники: ' + e.message, 'error')
    return
  }

  function renderShell() {
    root.innerHTML = `
      <div class="page-toolbar">
        <h2 class="page-title">Импорт банковской выписки</h2>
      </div>
      <div class="import-intro">
        Загрузите PDF-выписку Альфа-Банка — система разберёт операции, подберёт
        категории по правилам и покажет превью перед записью.
        Дубли по коду операции (CRD_…) определятся автоматически.
      </div>
      <div class="import-upload">
        <input type="file" id="import-file-input" accept="application/pdf,.pdf" style="display:none">
        <button class="btn btn-primary" id="import-choose">📄 Выбрать PDF…</button>
        <span id="import-filename" class="import-filename"></span>
      </div>
      <div id="import-summary"></div>
      <div id="import-table"></div>
    `
    document.getElementById('import-choose').addEventListener('click', () => {
      document.getElementById('import-file-input').click()
    })
    document.getElementById('import-file-input').addEventListener('change', e => {
      const f = e.target.files[0]
      if (f) handleFile(f)
    })
  }

  async function handleFile(file) {
    state.file = file
    document.getElementById('import-filename').textContent = file.name + ` (${(file.size / 1024).toFixed(1)} KB)`
    document.getElementById('import-summary').innerHTML = ''
    document.getElementById('import-table').innerHTML = '<div class="loading">Разбираю PDF…</div>'
    state.preview = null
    state.edits.clear()

    try {
      const preview = await postPdf('/api/import/alfa/preview', file)
      state.preview = preview
      renderSummary()
      renderTable()
    } catch (e) {
      toast('Не удалось разобрать PDF: ' + e.message, 'error')
      document.getElementById('import-table').innerHTML = `<div class="empty"><div class="empty-title">Не удалось разобрать PDF</div>${escapeHtml(e.message)}</div>`
    }
  }

  function renderSummary() {
    const t = state.preview?.totals || { found: 0, alreadyImported: 0, unresolvedAccount: 0 }
    const el = document.getElementById('import-summary')
    if (!state.preview) { el.innerHTML = ''; return }
    el.innerHTML = `
      <div class="import-summary">
        <span class="badge badge-info">Найдено: ${t.found}</span>
        ${t.alreadyImported ? `<span class="badge badge-warn">Уже импортировано: ${t.alreadyImported}</span>` : ''}
        ${t.unresolvedAccount ? `<span class="badge badge-warn">Без счёта (нужно выбрать): ${t.unresolvedAccount}</span>` : ''}
      </div>
    `
  }

  function getEdited(rowIdx, key, fallback) {
    const e = state.edits.get(rowIdx) || {}
    return e[key] !== undefined ? e[key] : fallback
  }

  function setEdited(rowIdx, patch) {
    const cur = state.edits.get(rowIdx) || {}
    state.edits.set(rowIdx, { ...cur, ...patch })
  }

  function renderTable() {
    const ops = state.preview?.operations || []
    const el = document.getElementById('import-table')
    if (ops.length === 0) {
      el.innerHTML = `<div class="empty">
        <div class="empty-title">Операций не найдено</div>
        Похоже, в выписке нет распознаваемых операций. Проверьте, что это
        именно Альфа-выписка в текстовом PDF (не скан).
      </div>`
      return
    }

    const accountOpts = id => `<option value="">— выбрать —</option>` +
      state.accounts.map(a => `<option value="${escapeHtml(a.id)}"${id === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')
    const categoryOpts = id => `<option value="">— без категории —</option>` +
      state.categories.map(c => `<option value="${escapeHtml(c.id)}"${id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')

    el.innerHTML = `
      <div class="table-wrap">
        <table class="table table-import">
          <thead>
            <tr>
              <th style="width:36px"></th>
              <th>Дата</th>
              <th style="width:70px">MCC</th>
              <th>Merchant</th>
              <th>Маска</th>
              <th>Счёт</th>
              <th>Категория</th>
              <th class="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${ops.map((op, i) => {
              const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
              const categoryId = getEdited(i, 'categoryId', op.suggestedCategoryId || '')
              const isDup = op.alreadyImported
              // HOLD-операции (неподтверждённые резервы) подсвечиваем жёлтым.
              // Это второй класс наравне с .row-dup (уже импортировано).
              const isHold = op.confirmed === false
              const isMinimal = op.recognitionLevel === 'minimal'
              const rowClass = [
                isDup && 'row-dup',
                isHold && !isDup && 'row-hold',
                isMinimal && !isDup && !isHold && 'row-minimal'
              ].filter(Boolean).join(' ')
              const ruleBadge = op.matchedRule
                ? `<span class="badge badge-info" title="Правило: ${escapeHtml(op.matchedRule.matchType)} = ${escapeHtml(op.matchedRule.matchValue)} (priority ${op.matchedRule.priority})">${escapeHtml(op.matchedRule.matchType)}</span>`
                : ''
              const holdBadge = isHold
                ? `<span class="badge badge-warn" title="Неподтверждённая операция (HOLD) — сумма зарезервирована банком, ещё не списана">HOLD</span>`
                : isMinimal
                  ? `<span class="badge badge-warn" title="Платёж через систему Альфа (штраф ГИБДД, СБП, ЖКХ) — нет карточных данных">платёж</span>`
                  : ''
              const saveAsRule = getEdited(i, 'saveAsRule', false)
              // Для «Сохранить как правило»: MCC или merchantName (хотя бы что-то для матча).
              const saveMcc = op.mcc
              const saveMerchant = op.merchantName
              return `
                <tr class="${rowClass}" data-idx="${i}">
                  <td><input type="checkbox" class="row-check" data-idx="${i}" ${isDup ? '' : 'checked'} ${isDup ? 'disabled' : ''} title="${isDup ? 'Уже импортировано' : 'Импортировать'}"></td>
                  <td>${escapeHtml(op.date)}${holdBadge ? ' ' + holdBadge : ''}</td>
                  <td><code>${escapeHtml(op.mcc || '—')}</code></td>
                  <td class="merchant-cell">${escapeHtml(op.merchantName || op.description || '—')}${ruleBadge ? ' ' + ruleBadge : ''}</td>
                  <td><code>${escapeHtml(op.panMask || '—')}</code></td>
                  <td>
                    <select class="row-account" data-idx="${i}">${accountOpts(accountId)}</select>
                    ${!op.resolvedAccountId ? '<span class="hint-warn">нет привязки</span>' : ''}
                  </td>
                  <td>
                    <select class="row-category" data-idx="${i}">${categoryOpts(categoryId)}</select>
                    ${categoryId && !op.suggestedCategoryId && (saveMcc || saveMerchant) ? `
                      <label class="hint-warn save-rule">
                        <input type="checkbox" class="row-save-rule" data-idx="${i}" ${saveAsRule ? 'checked' : ''}>
                        Сохранить как правило для ${saveMcc ? `MCC ${escapeHtml(saveMcc)}` : `merchant «${escapeHtml(saveMerchant)}»`}
                      </label>
                    ` : ''}
                  </td>
                  <td class="num num-${op.type}">${op.type === 'income' ? '+' : ''}${rub(op.type === 'expense' ? -op.amount : op.amount)}</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="import-actions">
        <button class="btn btn-primary" id="import-confirm">Импортировать выбранные</button>
        <span id="import-actions-summary" class="import-filename"></span>
      </div>
    `

    // События строк превью.
    el.querySelectorAll('.row-account').forEach(sel => {
      sel.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { accountId: e.target.value })
      })
    })
    el.querySelectorAll('.row-category').forEach(sel => {
      sel.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { categoryId: e.target.value })
        // При ручном выборе — перерисовать строку, чтобы появился чекбокс «сохранить как правило».
        renderTable()
      })
    })
    el.querySelectorAll('.row-save-rule').forEach(cb => {
      cb.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { saveAsRule: e.target.checked })
      })
    })
    document.getElementById('import-confirm').addEventListener('click', doImport)
  }

  async function doImport() {
    const ops = state.preview?.operations || []
    const items = []
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const checked = document.querySelector(`.row-check[data-idx="${i}"]`)?.checked
      if (!checked) continue
      const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
      if (!accountId) {
        toast(`Строка ${i + 1}: выберите счёт`, 'error')
        return
      }
      const categoryId = getEdited(i, 'categoryId', op.suggestedCategoryId || '') || null
      items.push({
        externalRef: op.externalRef,
        accountId,
        date: op.date,
        type: op.type,
        amount: Math.abs(op.amount),  // знак восстановит backend
        currency: op.currency,
        categoryId,
        mcc: op.mcc,
        merchantName: op.merchantName
      })
    }
    if (items.length === 0) {
      toast('Не выбрано ни одной операции', 'error')
      return
    }

    // Сначала создаём правила «Сохранить как…» (если пользователь их отметил).
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const save = state.edits.get(i)?.saveAsRule
      const categoryId = getEdited(i, 'categoryId', op.suggestedCategoryId || '')
      const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
      if (!save || !categoryId || !op.mcc) continue
      // Не создаём дубль, если правило с тем же matchValue+matchType уже есть.
      try {
        await api.post('/api/import-rules', {
          accountId: accountId || null,
          matchType: 'mcc',
          matchValue: op.mcc,
          categoryId,
          priority: 100
        })
      } catch (e) {
        // Дубль — игнорируем (это норма для глобальных правил).
        if (!String(e.message).includes('UNIQUE') && !String(e.message).includes('constraint')) {
          console.warn('не удалось сохранить правило для MCC', op.mcc, e)
        }
      }
    }

    const btn = document.getElementById('import-confirm')
    btn.disabled = true
    btn.textContent = 'Импортирую…'
    try {
      const result = await api.post('/api/transactions/import', { operations: items })
      toast(`Готово: создано ${result.created}, уже было ${result.skipped}, ошибок ${result.errors.length}`, 'success')
      renderResultBlock(result)
      // Прячем кнопку, чтобы случайно не нажать повторно.
      btn.style.display = 'none'
    } catch (e) {
      toast('Импорт не удался: ' + e.message, 'error')
    } finally {
      btn.disabled = false
      btn.textContent = 'Импортировать выбранные'
    }
  }

  function renderResultBlock(result) {
    const el = document.getElementById('import-summary')
    const errRows = result.errors.length
      ? `<ul>${result.errors.map(e => `<li><code>${escapeHtml(e.externalRef)}</code>: ${escapeHtml(e.reason)}</li>`).join('')}</ul>`
      : ''
    el.innerHTML = `
      <div class="import-summary">
        <span class="badge badge-ok">Создано: ${result.created}</span>
        <span class="badge badge-info">Уже было: ${result.skipped}</span>
        ${errRows ? `<span class="badge badge-error">Ошибок: ${result.errors.length}</span>` : ''}
      </div>
      ${errRows}
      <p style="margin-top:12px"><a href="#/transactions" class="btn">Открыть список операций →</a></p>
    `
  }

  renderShell()
}