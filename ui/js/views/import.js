// Импорт банковских выписок (Альфа / Точка): загрузка файла, превью-таблица,
// inline-редактирование счёта и категории, импорт выбранного.
//
// UX:
//   1. Пользователь выбирает банк (таб Альфа/Точка) и загружает файл
//      (PDF или CSV для Альфы, CSV для Точки).
//   2. POST /api/import/{alfa,tochka}/preview → { operations, totals }.
//   3. Таблица: чекбокс | дата | MCC | merchant | маска | счёт (select) |
//      категория (select) | сумма. Для переводов собственных средств (transfer)
//      в колонке «Счёт» показываются ДВА select'а — источник и получатель.
//      Уже импортированные — отмечены и disabled.
//   4. Категория подставляется из import_rules (suggestedCategoryId +
//      matchedRule). Если ничего не нашлось — пустой select.
//   5. Кнопка «Импортировать выбранные» → POST /api/transactions/import.
//      Сводка: «N создано, M уже было, K пропущено/ошибок».
//
// Inline-правка категории без правила: при выборе категории вручную
// появляется чекбокс «Сохранить как правило для MCC …» — правило создаётся
// POST /api/import-rules перед записью операций (если отмечено).

import { api, rub, toast, escapeHtml } from '../api.js'


// POST бинарного/текстового файла (PDF/CSV выписки) на preview.
// Отдельный метод, потому что стандартный api.post всегда Content-Type: json.
async function postFile(path, file, contentType) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
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

// Ключ уникальности правила маппинга — та же тройка, что и в UNIQUE-индексе
// idx_import_rules_unique (миграция 017). accountId = NULL → глобальное правило.
function ruleKey(matchType, matchValue, accountId) {
  return `${matchType}|${String(matchValue ?? '').trim()}|${accountId || ''}`
}

export async function render(root) {
  // Состояние страницы в замыкании. Один источник истины для UI.
  const state = {
    bankSource: 'alfa',       // 'alfa' | 'tochka' — выбранный таб
    accounts: [],
    categories: [],
    file: null,
    preview: null,           // { operations, totals } от preview-эндпоинта
    // Локальные правки пользователя: rowId -> { accountId, transferAccountId, categoryId, saveAsRule }
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

  // Конфиг по банку — вынесен, чтобы табы и обработчики использовали один источник.
  // У Альфы возможны два формата (PDF и CSV) — какой endpoint/Content-Type
  // использовать, решает resolve(file) по расширению.
  const BANK_CONFIG = {
    alfa: {
      label: 'Альфа',
      icon: 'fa-credit-card',
      accept: 'application/pdf,.pdf,text/csv,.csv',
      buttonLabel: '📄 Выбрать PDF или CSV…',
      intro: 'Загрузите выписку Альфа-Банка — PDF или CSV. Система разберёт операции, подберёт категории по правилам и покажет превью перед записью. Счёт определяется по номеру счёта или маске карты, переводы между своими счетами склеиваются в один transfer.',
      emptyMsg: 'Похоже, в выписке нет распознаваемых операций. Проверьте, что это именно Альфа-выписка (CSV с шапкой operationDate,… или текстовый PDF, не скан).',
      processingLabel: 'Разбираю выписку…',
      resolve: (file) => (String(file && file.name || '').toLowerCase().endsWith('.csv')
        ? { endpoint: '/api/import/alfa-csv/preview', contentType: 'text/csv', processingLabel: 'Разбираю CSV…' }
        : { endpoint: '/api/import/alfa/preview', contentType: 'application/pdf', processingLabel: 'Разбираю PDF…' })
    },
    tochka: {
      label: 'Точка',
      icon: 'fa-university',
      accept: 'text/csv,.csv',
      buttonLabel: '📊 Выбрать CSV…',
      intro: 'Загрузите CSV-выписку Точка-Банка (UTF-8, BOM допустим, разделитель «;»). Переводы собственных средств между своими счетами попадут в тип transfer — для них нужно выбрать 2 счёта (источник и получатель). Дубли по «Номеру документа» определятся автоматически.',
      emptyMsg: 'Похоже, в выписке нет распознаваемых операций. Проверьте, что это именно CSV-выписка Точка-Банка с разделителем «;».',
      processingLabel: 'Разбираю CSV…',
      resolve: () => ({ endpoint: '/api/import/tochka/preview', contentType: 'text/csv', processingLabel: 'Разбираю CSV…' })
    }
  }

  function renderShell() {
    const cfg = BANK_CONFIG[state.bankSource]
    root.innerHTML = `
      <div class="page-toolbar">
        <h2 class="page-title">Импорт банковской выписки</h2>
        <div class="import-bank-tabs">
          <button class="bank-tab ${state.bankSource === 'alfa' ? 'active' : ''}" data-bank="alfa">
            <i class="fa fa-credit-card"></i> Альфа
          </button>
          <button class="bank-tab ${state.bankSource === 'tochka' ? 'active' : ''}" data-bank="tochka">
            <i class="fa fa-university"></i> Точка
          </button>
        </div>
      </div>
      <div class="import-intro">${escapeHtml(cfg.intro)}</div>
      ${state.bankSource === 'tochka' ? `
        <div class="hint-warn" style="margin-bottom:12px">
          <i class="fa fa-info-circle"></i>
          Переводы собственных средств записываются как 2 связанные операции, но <b>балансы счетов не двигаются автоматически</b> —
          формула «остатка» исключает transfer. После импорта перепроверьте балансы через «Счета и карты → Сверка».
        </div>
      ` : ''}
      <div class="import-upload">
        <input type="file" id="import-file-input" accept="${cfg.accept}" style="display:none">
        <button class="btn btn-primary" id="import-choose">${escapeHtml(cfg.buttonLabel)}</button>
        <span id="import-filename" class="import-filename"></span>
      </div>
      <div id="import-summary"></div>
      <div id="import-table"></div>
    `
    // Табы переключают банк: меняется accept у input, интро и endpoint.
    // При смене банка сбрасываем preview — это разные операции и даже разные
    // поля (transfer есть только у Точки).
    document.querySelectorAll('.bank-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.bank
        if (next === state.bankSource) return
        state.bankSource = next
        state.preview = null
        state.edits.clear()
        state.checked = new Map()
        document.getElementById('import-filename').textContent = ''
        document.getElementById('import-summary').innerHTML = ''
        document.getElementById('import-table').innerHTML = ''
        renderShell()
      })
    })
    document.getElementById('import-choose').addEventListener('click', () => {
      document.getElementById('import-file-input').click()
    })
    document.getElementById('import-file-input').addEventListener('change', e => {
      const f = e.target.files[0]
      if (f) handleFile(f)
    })
  }

  // Опции для select'ов счёта/категории. Подняты на уровень render(), чтобы
  // updateCategoryCell() мог их переиспользовать без перерисовки всей таблицы.
  const accountOpts = id => `<option value="">— выбрать —</option>` +
    state.accounts.map(a => `<option value="${escapeHtml(a.id)}"${id === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')
  const categoryOpts = id => `<option value="">— без категории —</option>` +
    state.categories.map(c => `<option value="${escapeHtml(c.id)}"${id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')

  async function handleFile(file) {
    const cfg = BANK_CONFIG[state.bankSource]
    const transport = cfg.resolve(file)
    state.file = file
    document.getElementById('import-filename').textContent = file.name + ` (${(file.size / 1024).toFixed(1)} KB)`
    document.getElementById('import-summary').innerHTML = ''
    document.getElementById('import-table').innerHTML = `<div class="loading">${escapeHtml(transport.processingLabel)}</div>`
    state.preview = null
    state.edits.clear()
    state.checked = new Map()    // явно проставленные галочки пользователем

    try {
      const preview = await postFile(transport.endpoint, file, transport.contentType)
      state.preview = preview
      // Defaults: новые операции — checked, дубли — unchecked (они и так disabled).
      preview.operations.forEach((op, i) => state.checked.set(i, !op.alreadyImported))
      renderSummary()
      renderTable()
    } catch (e) {
      toast('Не удалось разобрать файл: ' + e.message, 'error')
      document.getElementById('import-table').innerHTML = `<div class="empty"><div class="empty-title">Не удалось разобрать файл</div>${escapeHtml(e.message)}</div>`
    }
  }

  function renderSummary() {
    const t = state.preview?.totals || { found: 0, alreadyImported: 0, unresolvedAccount: 0, transferCount: 0 }
    const el = document.getElementById('import-summary')
    if (!state.preview) { el.innerHTML = ''; return }
    el.innerHTML = `
      <div class="import-summary">
        <span class="badge badge-info">Найдено: ${t.found}</span>
        ${t.alreadyImported ? `<span class="badge badge-warn">Уже импортировано: ${t.alreadyImported}</span>` : ''}
        ${t.unresolvedAccount ? `<span class="badge badge-warn">Без счёта (нужно выбрать): ${t.unresolvedAccount}</span>` : ''}
        ${t.transferCount ? `<span class="badge badge-info" title="Переводы между своими счетами — для каждой нужен счёт-источник и счёт-получатель">Переводов: ${t.transferCount}</span>` : ''}
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
    const cfg = BANK_CONFIG[state.bankSource]
    if (ops.length === 0) {
      el.innerHTML = `<div class="empty">
        <div class="empty-title">Операций не найдено</div>
        ${escapeHtml(cfg.emptyMsg)}
      </div>`
      return
    }

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
              <th>Счёт${state.bankSource === 'tochka' ? ' (источник → получатель)' : ''}</th>
              <th>Категория</th>
              <th class="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${ops.map((op, i) => {
              const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
              const transferAccountId = getEdited(i, 'transferAccountId', op.transferAccountId || '')
              const categoryId = getEdited(i, 'categoryId', op.suggestedCategoryId || '')
              const isDup = op.alreadyImported
              const isTransfer = op.type === 'transfer'
              // HOLD-операции (неподтверждённые резервы) подсвечиваем жёлтым.
              // Это второй класс наравне с .row-dup (уже импортировано).
              const isHold = op.confirmed === false
              const isMinimal = op.recognitionLevel === 'minimal'
              const rowClass = [
                isDup && 'row-dup',
                isHold && !isDup && 'row-hold',
                isMinimal && !isDup && !isHold && 'row-minimal',
                isTransfer && !isDup && 'row-transfer'
              ].filter(Boolean).join(' ')
              const ruleBadge = op.matchedRule
                ? `<span class="badge badge-info" title="Правило: ${escapeHtml(op.matchedRule.matchType)} = ${escapeHtml(op.matchedRule.matchValue)} (priority ${op.matchedRule.priority})">${escapeHtml(op.matchedRule.matchType)}</span>`
                : ''
              const holdBadge = isHold
                ? `<span class="badge badge-warn" title="Неподтверждённая операция (HOLD) — сумма зарезервирована банком, ещё не списана">HOLD</span>`
                : isTransfer
                  ? `<span class="badge badge-info" title="Перевод собственных средств между счетами — нужны счёт-источник и счёт-получатель">перевод</span>`
                  : isMinimal
                    ? `<span class="badge badge-warn" title="Платёж через систему банка (штраф, СБП, ЖКХ) — нет карточных данных">платёж</span>`
                    : ''
              const saveAsRule = getEdited(i, 'saveAsRule', false)
              // Для «Сохранить как правило»: MCC или merchantName (хотя бы что-то для матча).
              const saveMcc = op.mcc
              const saveMerchant = op.merchantName

              // Колонка «Счёт»: для transfer — 2 select'а (источник и получатель),
              // иначе — 1 select. Для transfer категория не нужна (показываем прочерк).
              const accountCell = isTransfer ? `
                <select class="row-account-source" data-idx="${i}">${accountOpts(accountId)}</select>
                <i class="fa fa-arrow-right" title="→"></i>
                <select class="row-account-target" data-idx="${i}">${accountOpts(transferAccountId)}</select>
                <div class="transfer-context" title="Счёт плательщика и счёт получателя по выписке">
                  <span class="hint-muted">${escapeHtml((op.payerAccount || '') + ' → ' + (op.payeeAccount || ''))}</span>
                  ${(op.resolvedAccountId && op.transferAccountId)
                    ? '<span class="badge badge-ok" style="margin-left:4px" title="Счета определены автоматически по номерам из выписки">✓ авто</span>'
                    : '<span class="hint-warn" style="margin-left:4px">нет привязки</span>'}
                </div>
              ` : `
                <select class="row-account" data-idx="${i}">${accountOpts(accountId)}</select>
                ${op.resolvedAccountId
                  ? '<span class="badge badge-ok" style="margin-left:4px" title="Счёт определён автоматически по номеру из выписки">✓ авто</span>'
                  : '<span class="hint-warn" style="margin-left:4px">нет привязки</span>'}
              `
              // Категория — для transfer не показываем select, только прочерк (там
              // нет категорий по логике перемещения средств между своими счетами).
              const categoryCell = isTransfer ? `<span class="hint-muted">—</span>` : `
                <select class="row-category" data-idx="${i}">${categoryOpts(categoryId)}</select>
                ${(() => {
                  const matchesSuggested = (categoryId || '') === (op.suggestedCategoryId || '')
                  const showSave = !!(categoryId && (saveMcc || saveMerchant) && !matchesSuggested)
                  return showSave ? `
                    <label class="hint-warn save-rule">
                      <input type="checkbox" class="row-save-rule" data-idx="${i}" ${saveAsRule ? 'checked' : ''}>
                      Сохранить как правило для ${saveMcc ? `MCC ${escapeHtml(saveMcc)}` : `merchant «${escapeHtml(saveMerchant)}»`}
                    </label>
                  ` : ''
                })()}
              `

              return `
                <tr class="${rowClass}" data-idx="${i}">
                  <td><input type="checkbox" class="row-check" data-idx="${i}" ${isDup ? '' : (state.checked.get(i) !== false ? 'checked' : '')} ${isDup ? 'disabled' : ''} title="${isDup ? 'Уже импортировано' : 'Импортировать'}"></td>
                  <td>${escapeHtml(op.date)}${holdBadge ? ' ' + holdBadge : ''}</td>
                  <td><code>${escapeHtml(op.mcc || '—')}</code></td>
                  <td class="merchant-cell">${escapeHtml(op.merchantName || op.description || '—')}${ruleBadge ? ' ' + ruleBadge : ''}</td>
                  <td><code>${escapeHtml(op.panMask || '—')}</code></td>
                  <td class="account-cell">${accountCell}</td>
                  <td class="category-cell">${categoryCell}</td>
                  <td class="num num-${op.type}">${op.type === 'income' ? '+' : ''}${rub(op.type === 'expense' ? -op.amount : op.amount)}</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="import-actions">
        <button class="btn btn-sm" id="import-check-all" title="Отметить все новые операции">☑ Выбрать все</button>
        <button class="btn btn-sm" id="import-uncheck-all" title="Снять все отметки">☐ Снять все</button>
        <button class="btn btn-primary" id="import-confirm">Импортировать выбранные</button>
        <span id="import-actions-summary" class="import-filename"></span>
      </div>
    `

    // Bulk-выбор: «Выбрать все» / «Снять все» — только для не-disabled
    // чекбоксов (дубли alreadyImported не трогаем, чтобы случайно не
    // переимпортировать уже существующее).
    const setAllCheckboxes = (checked) => {
      el.querySelectorAll('.row-check:not(:disabled)').forEach(cb => {
        cb.checked = checked
        state.checked.set(Number(cb.dataset.idx), checked)
      })
    }
    document.getElementById('import-check-all').addEventListener('click', () => setAllCheckboxes(true))
    document.getElementById('import-uncheck-all').addEventListener('click', () => setAllCheckboxes(false))

    // События строк превью.
    el.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', e => {
        state.checked.set(Number(e.target.dataset.idx), e.target.checked)
      })
    })
    // Счёт — обычный (1 select)
    el.querySelectorAll('.row-account').forEach(sel => {
      sel.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { accountId: e.target.value })
      })
    })
    // Счёт для transfer (2 select'а: source и target)
    el.querySelectorAll('.row-account-source').forEach(sel => {
      sel.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { accountId: e.target.value })
      })
    })
    el.querySelectorAll('.row-account-target').forEach(sel => {
      sel.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { transferAccountId: e.target.value })
      })
    })
    el.querySelectorAll('.row-category').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = Number(e.target.dataset.idx)
        const newCat = e.target.value
        const op = state.preview.operations[idx]
        // Автоматически предлагаем создать правило, если пользователь выбрал
        // категорию, отличную от предложенной парсером — и есть MCC/merchant
        // для матча. Чекбокс всё ещё можно снять руками (не обязательно).
        const matchesSuggested = newCat === (op.suggestedCategoryId || '')
        const hasMatchKey = !!(op.mcc || op.merchantName)
        if (newCat && !matchesSuggested && hasMatchKey) {
          setEdited(idx, { categoryId: newCat, saveAsRule: true })
        } else {
          setEdited(idx, { categoryId: newCat })
        }
        // Точечное обновление: только ячейка категории (показать/скрыть
        // чекбокс «сохранить как правило»). НЕ перерисовываем всю таблицу —
        // иначе сбросятся все галочки .row-check, выбранные пользователем.
        updateCategoryCell(idx)
      })
    })
    el.querySelectorAll('.row-save-rule').forEach(cb => {
      cb.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { saveAsRule: e.target.checked })
      })
    })
    document.getElementById('import-confirm').addEventListener('click', doImport)
  }

  // Точечный апдейт ячейки категории: перерисовать select + при необходимости
  // добавить/убрать блок «сохранить как правило». Не трогает остальные строки.
  function updateCategoryCell(idx) {
    const row = el.querySelector(`tr[data-idx="${idx}"]`)
    if (!row) return
    const cell = row.querySelector('.category-cell')
    if (!cell) return
    const op = state.preview.operations[idx]
    const categoryId = getEdited(idx, 'categoryId', op.suggestedCategoryId || '')
    const saveAsRule = getEdited(idx, 'saveAsRule', false)
    const saveMcc = op.mcc
    const saveMerchant = op.merchantName
    const matchesSuggested = (categoryId || '') === (op.suggestedCategoryId || '')
    const showSave = !!(categoryId && (saveMcc || saveMerchant) && !matchesSuggested)
    cell.innerHTML = `
      <select class="row-category" data-idx="${idx}">${categoryOpts(categoryId)}</select>
      ${showSave ? `
        <label class="hint-warn save-rule">
          <input type="checkbox" class="row-save-rule" data-idx="${idx}" ${saveAsRule ? 'checked' : ''}>
          Сохранить как правило для ${saveMcc ? `MCC ${escapeHtml(saveMcc)}` : `merchant «${escapeHtml(saveMerchant)}»`}
        </label>
      ` : ''}
    `
    // Перенавешиваем обработчики на новые элементы ячейки.
    cell.querySelector('.row-category').addEventListener('change', e => {
      const newCat = e.target.value
      const m = newCat === (op.suggestedCategoryId || '')
      const k = !!(op.mcc || op.merchantName)
      if (newCat && !m && k) setEdited(idx, { categoryId: newCat, saveAsRule: true })
      else setEdited(idx, { categoryId: newCat })
      updateCategoryCell(idx)
    })
    const sr = cell.querySelector('.row-save-rule')
    if (sr) sr.addEventListener('change', e => setEdited(idx, { saveAsRule: e.target.checked }))
  }

  async function doImport() {
    const ops = state.preview?.operations || []
    const items = []
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const checked = document.querySelector(`.row-check[data-idx="${i}"]`)?.checked
      if (!checked) continue
      const isTransfer = op.type === 'transfer'
      const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
      if (!accountId) {
        toast(`Строка ${i + 1}: выберите счёт-источник`, 'error')
        return
      }
      // Для transfer дополнительно требуется счёт-получатель.
      // Бэкенд сам проверит, что source != target.
      let transferAccountId = null
      if (isTransfer) {
        transferAccountId = getEdited(i, 'transferAccountId', '')
        if (!transferAccountId) {
          toast(`Строка ${i + 1} (перевод): выберите счёт-получатель`, 'error')
          return
        }
      }
      const categoryId = isTransfer ? null : (getEdited(i, 'categoryId', op.suggestedCategoryId || '') || null)
      const item = {
        externalRef: op.externalRef,
        accountId,
        date: op.date,
        type: op.type,
        amount: Math.abs(op.amount),  // знак восстановит backend
        currency: op.currency,
        categoryId,
        mcc: op.mcc,
        merchantName: op.merchantName,
        bankSource: state.bankSource
      }
      if (isTransfer) item.transferAccountId = transferAccountId
      items.push(item)
    }
    if (items.length === 0) {
      toast('Не выбрано ни одной операции', 'error')
      return
    }

    // Сначала создаём правила «Сохранить как…» (если пользователь их отметил).
    // Существующие правила подгружаем один раз и проверяем ДО POST: тот же
    // matchType+matchValue+accountId теперь блокируется UNIQUE-индексом
    // (миграция 017), поэтому не шлём заведомо падающий дубль.
    const existingRuleKeys = new Set()
    if (ops.some((_, i) => state.edits.get(i)?.saveAsRule)) {
      try {
        const rules = await api.get('/api/import-rules')
        for (const r of rules) existingRuleKeys.add(ruleKey(r.matchType, r.matchValue, r.accountId))
      } catch (e) {
        // Справочник недоступен — не блокируем импорт: UNIQUE-индекс на
        // бэкенде всё равно не даст создать дубль.
        console.warn('не удалось загрузить правила маппинга', e)
      }
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const save = state.edits.get(i)?.saveAsRule
      const categoryId = getEdited(i, 'categoryId', op.suggestedCategoryId || '')
      const accountId = getEdited(i, 'accountId', op.resolvedAccountId || '')
      if (!save || !categoryId || !op.mcc) continue
      const key = ruleKey('mcc', op.mcc, accountId)
      if (existingRuleKeys.has(key)) continue // правило уже есть — не дублируем
      try {
        await api.post('/api/import-rules', {
          accountId: accountId || null,
          matchType: 'mcc',
          matchValue: op.mcc,
          categoryId,
          priority: 100
        })
        existingRuleKeys.add(key)
      } catch (e) {
        // Гонка (правило создано параллельно) — не ошибка импорта операций.
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