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

import { api, rub, toast, escapeHtml, escapeAttr } from '../api.js'
import { openModal } from '../ui/modal.js'
import { categoryIconHTML } from '../data/categoryIcons.js'


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
    fileName: '',            // имя файла — только для подписи после восстановления (File не переживает F5)
    preview: null,           // { operations, totals } от preview-эндпоинта
    // Локальные правки пользователя: rowId -> { accountId, transferAccountId, categoryId, saveAsRule }
    edits: new Map(),
    loading: false,
    imported: false         // успешный импорт уже прошёл — превью больше не сохраняем
  }

  // Сколько номеров строк показывать в подсказке «Заполните данные: …» до
  // сворачивания. В выписке Точки на 200+ строк полный перечень занимал
  // пол-экрана и сдвигал таблицу; остальные прячем за «… ещё N».
  const INVALID_ROWS_MAX = 12
  let invalidExpanded = false

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

  // Превью импорта переживает F5 (и уход на другую страницу с возвратом):
  // сериализуем разобранную выписку + все правки пользователя в sessionStorage.
  // Именно sessionStorage, а не localStorage: данные актуальны для текущей
  // вкладки и не должны «всплывать» через неделю.
  // Ключ версионирован: v2 — добавлены данные дублей из БД (existing*) и
  // rawSource. Старое превью из v1 невалидно (там этих полей нет), поэтому
  // читаем только v2 — иначе дубли снова выглядели бы незаполненными.
  const PERSIST_KEY = 'finans.import.preview.v2'
  let persistTimer = null

  function persistStateNow() {
    if (!state.preview || state.imported) return
    try {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify({
        bankSource: state.bankSource,
        fileName: state.fileName || '',
        preview: state.preview,
        edits: [...state.edits],
        checked: [...state.checked]
      }))
    } catch (e) {
      // Приватный режим / квота — не критично: просто не переживёт обновление.
      console.warn('не удалось сохранить превью импорта в sessionStorage', e)
    }
  }

  // Дебаунс: правки идут пачками («выбрать все», смена категории), а превью
  // на 300+ операций незачем сериализовать на каждое нажатие.
  function schedulePersist() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persistStateNow, 300)
  }

  function restorePersistedState() {
    let raw = null
    try { raw = sessionStorage.getItem(PERSIST_KEY) } catch { raw = null }
    if (!raw) return false
    try {
      const data = JSON.parse(raw)
      const ops = data?.preview?.operations
      if (!Array.isArray(ops) || ops.length === 0) {
        clearPersistedState()
        return false
      }
      state.bankSource = data.bankSource === 'tochka' ? 'tochka' : 'alfa'
      state.fileName = data.fileName || ''
      state.preview = data.preview
      state.edits = new Map((data.edits || []).map(([k, v]) => [Number(k), v]))
      state.checked = new Map((data.checked || []).map(([k, v]) => [Number(k), v]))
      return true
    } catch (e) {
      console.warn('не удалось восстановить превью импорта', e)
      clearPersistedState()
      return false
    }
  }

  function clearPersistedState() {
    clearTimeout(persistTimer)
    try { sessionStorage.removeItem(PERSIST_KEY) } catch { /* ignore */ }
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
      <div id="import-table" class="import-table"></div>
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
        state.fileName = ''
        state.edits.clear()
        state.checked = new Map()
        clearPersistedState()
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

  // Единый inline-выбор в ячейке (счёт или категория): кнопка + всплывающий
  // список с поиском по подстроке. Нативный <select> искать не умеет, а списки
  // длинные; у категорий ещё и имена повторяются у расходов/доходов («Прочее»),
  // поэтому выбор всегда идёт по id, а не по тексту.
  // Категории фильтруем по типу операции: расходной строке предлагаем только
  // расходные категории, доходной — только доходные. Иначе в списке соседствуют
  // оба «Прочее» и легко выбрать категорию не того типа. Если тип неизвестен
  // (transfer), фильтр не применяется.
  function categoriesForType(rowType) {
    if (rowType === 'expense' || rowType === 'income') {
      return state.categories.filter(c => c.type === rowType)
    }
    return state.categories
  }

  function categoryOption(c) {
    return { value: c.id, label: c.name, html: `${categoryIconHTML(c.icon)} ${escapeHtml(c.name)}` }
  }

  function pickOptions(field, rowType) {
    if (field === 'categoryId') {
      return [
        { value: '', label: '— без категории —', html: '— без категории —' },
        ...categoriesForType(rowType).map(categoryOption)
      ]
    }
    return [
      { value: '', label: '— выбрать —', html: '— выбрать —' },
      ...state.accounts.map(a => ({ value: a.id, label: a.name, html: escapeHtml(a.name) }))
    ]
  }

  // Тип операции строки с учётом ручных правок — по нему фильтруются категории.
  function rowTypeOf(idx) {
    const op = state.preview?.operations[idx]
    return op ? getEdited(idx, 'type', baseValue(op, 'type')) : null
  }

  // Экранирование спецсимволов для descriptionRegex: значение правила — это
  // регулярное выражение, поэтому текст выписки экранируем и он матчится буквально.
  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // Чем можно заматчить правило для строки: MCC → merchantName → текст операции.
  // У СБП/QR/налога/оплаты по счёту у Точки нет ни MCC, ни merchant — только
  // «Назначение платежа» (description), поэтому для них доступен
  // matchType=descriptionRegex. Без этого «Сохранить как правило» таким
  // операциям не предлагалось вообще.
  function ruleMatchFor(op) {
    if (op.mcc) return { matchType: 'mcc', matchValue: String(op.mcc).trim(), label: `MCC ${op.mcc}` }
    const merchant = (op.merchantName || '').trim()
    if (merchant) return { matchType: 'merchantName', matchValue: merchant, label: `merchant «${merchant}»` }
    const desc = (op.description || '').trim()
    if (desc) {
      return { matchType: 'descriptionRegex', matchValue: escapeRegex(desc), label: `текст «${shortText(desc, 64)}»` }
    }
    return null
  }

  function pickButtonHTML(idx, field, value, disabled) {
    const isCategory = field === 'categoryId'
    const opts = pickOptions(field, isCategory ? rowTypeOf(idx) : null)
    let found = opts.find(o => String(o.value) === String(value || ''))
    // Значение может не входить в список своего типа (категория из правила,
    // из БД или после смены вида). Подпись всё равно рисуем — иначе ячейка
    // выглядела бы пустой; в список для выбора её при этом не добавляем.
    if (!found && isCategory && value) {
      const c = state.categories.find(c => c.id === value)
      if (c) found = categoryOption(c)
    }
    const emptyText = isCategory ? '— без категории —' : '— выбрать —'
    let title = (found && found.value ? found.label : (isCategory ? 'Категория не выбрана' : 'Счёт не выбран')) +
      ' — нажмите, чтобы выбрать (с поиском)'
    if (isCategory) {
      // Категория банка из выписки — в подсказке: видно, откуда взялась
      // подставленная категория (и почему она такая).
      const bank = state.preview?.operations[idx]?.bankCategory
      if (bank) title += `\nКатегория банка в выписке: «${bank}»`
    }
    return `<button type="button" class="inline-pick${value ? '' : ' is-empty'}"`
      + ` data-idx="${idx}" data-field="${field}" ${disabled ? 'disabled' : ''}`
      + ` title="${escapeAttr(title)}">`
      + `<span class="inline-pick-name">${found && found.value ? found.html : emptyText}</span>`
      + `<i class="fa fa-caret-down inline-pick-caret" aria-hidden="true"></i>`
      + '</button>'
  }

  function bindPick(btn) {
    if (!btn || btn.disabled) return
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = Number(btn.dataset.idx)
      const field = btn.dataset.field
      // Повторный клик по той же кнопке закрывает список (toggle).
      if (pickPopover && pickPopover.dataset.idx === String(idx) && pickPopover.dataset.field === field) {
        closePickPopover()
        return
      }
      openPickPopover(idx, btn, field)
    })
  }
  // Вид операции (transactions.type). Парсер берёт его из колонки `type`
  // выписки (Списание/Пополнение), но у брокерских и банковских операций
  // бывают спорные случаи — даём исправить руками. transfer переключает строку
  // на два счёта (источник → получатель).
  const TYPE_OPTIONS = [
    ['expense', 'Расход (−)'],
    ['income', 'Доход (+)'],
    ['transfer', 'Перевод (⇄)']
  ]
  const typeOpts = id => TYPE_OPTIONS
    .map(([v, label]) => `<option value="${v}"${id === v ? ' selected' : ''}>${label}</option>`).join('')
  // Тип показан иконкой у суммы (колонки «Вид» нет), редактор открывается
  // кликом по иконке — см. обработчик .type-toggle в renderTable().
  const TYPE_ICON = { expense: 'fa-arrow-down', income: 'fa-arrow-up', transfer: 'fa-exchange' }
  const TYPE_LABEL = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' }

  async function handleFile(file) {
    const cfg = BANK_CONFIG[state.bankSource]
    const transport = cfg.resolve(file)
    state.file = file
    state.fileName = file.name
    document.getElementById('import-filename').textContent = file.name + ` (${(file.size / 1024).toFixed(1)} KB)`
    document.getElementById('import-summary').innerHTML = ''
    document.getElementById('import-table').innerHTML = `<div class="loading">${escapeHtml(transport.processingLabel)}</div>`
    state.preview = null
    state.imported = false
    state.edits.clear()
    state.checked = new Map()    // явно проставленные галочки пользователем
    // Старое превью заменяем — не должно всплыть после F5, если разбор упадёт.
    clearPersistedState()

    try {
      const preview = await postFile(transport.endpoint, file, transport.contentType)
      state.preview = preview
      // Defaults: новые операции — checked, дубли — unchecked (они и так disabled).
      preview.operations.forEach((op, i) => state.checked.set(i, !op.alreadyImported))
      renderSummary()
      renderTable()
      // Пишем сразу, не ждём дебаунса: пользователь может обновить страницу
      // сразу после загрузки файла.
      persistStateNow()
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

  // Значение поля строки «по умолчанию» — без правок пользователя. Дубли берут
  // то, что реально лежит в БД. Одна логика для рендера, импорта и bulk-правок.
  function baseValue(op, field) {
    const dup = op.alreadyImported
    switch (field) {
      case 'accountId': return op.resolvedAccountId || (dup ? op.existingAccountId : '') || ''
      case 'transferAccountId': return op.transferAccountId || (dup ? op.existingTransferAccountId : '') || ''
      case 'categoryId': return op.suggestedCategoryId || (dup ? op.existingCategoryId : '') || ''
      case 'type': return (dup && op.existingType) ? op.existingType : op.type
      default: return ''
    }
  }

  const FIELD_LABEL = {
    accountId: 'Счёт',
    transferAccountId: 'Счёт-получатель',
    categoryId: 'Категория',
    type: 'Вид'
  }

  // Короткая подпись длинного текста (в подсказках/модалке).
  function shortText(value, max = 56) {
    const s = String(value || '').trim()
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }

  // Ключ merchant для группировки: регистр, кавычки и хвостовые номера/годы не
  // мешают («Комиссия за Альфа-Смарт 2025» ≈ «Комиссия за Альфа-Смарт (12)»).
  function merchantKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[«»"'`]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[№#]?\s*\d[\d\s./-]*$/, '')
      .trim()
  }

  // Признак «однотипности» строк: для счёта важнее карта, затем merchant;
  // для категории/вида — сначала MCC, затем merchant, затем текст операции
  // (у СБП/QR/налога/оплаты по счёту нет ни MCC, ни merchant), в последнюю
  // очередь категория банка. Нет признака — нет и предложения (лучше ничего
  // не менять, чем изменить не то).
  function similarGroup(op, field) {
    const merchant = (op.merchantName || '').trim()
    const mKey = merchantKey(merchant)
    const isAccount = field === 'accountId' || field === 'transferAccountId'
    if (isAccount && op.panMask) return { key: `pan:${op.panMask}`, label: `карта ${op.panMask}` }
    if (!isAccount && op.mcc) return { key: `mcc:${op.mcc}`, label: `MCC ${op.mcc}` }
    if (mKey) return { key: `merchant:${mKey}`, label: `«${merchant}»` }
    if (!isAccount) {
      // Единственный признак операций без карты (СБП/QR/налог/счёт) — текст
      // «Назначения платежа». Одинаковый текст = та же операция/получатель,
      // поэтому такие строки тоже считаем похожими (иначе для них «применить
      // к похожим» не предлагалось вообще).
      const dKey = merchantKey(op.description)
      if (dKey) return { key: `desc:${dKey}`, label: `текст «${shortText(op.description)}»` }
      if (op.bankCategory) {
        return { key: `bankcat:${String(op.bankCategory).toLowerCase()}`, label: `категория банка «${op.bankCategory}»` }
      }
    }
    return null
  }

  function valueLabel(field, value) {
    if (field === 'categoryId') return (state.categories.find(c => c.id === value) || {}).name || '—'
    if (field === 'accountId' || field === 'transferAccountId') return (state.accounts.find(a => a.id === value) || {}).name || '—'
    if (field === 'type') return TYPE_LABEL[value] || value
    return String(value)
  }

  // После правки в строке idx ищем строки, куда ту же правку логично применить:
  //   1) «похожие» — тот же merchant/MCC/карта (см. similarGroup);
  //   2) «пустые» — строки без категории / без счёта: частая ситуация «много
  //      банковских комиссий с разными названиями, категории нигде нет».
  // Молча ничего не меняем: спрашиваем в модальном окне (showBulkModal).
  function offerBulkApply(idx, field, value) {
    const ops = state.preview?.operations || []
    const src = ops[idx]
    if (!src || !value) return
    const srcType = getEdited(idx, 'type', baseValue(src, 'type'))
    const group = similarGroup(src, field)
    const idxs = []
    const emptyIdxs = []
    for (let i = 0; i < ops.length; i++) {
      if (i === idx) continue
      // Дубли уже в БД и только для чтения — их не трогаем. Остальные строки
      // (в т.ч. снятые галочки) включаем: категория/счёт — свойство данных,
      // а не факт импорта.
      if (ops[i].alreadyImported) continue
      // Поле применимо не к каждой строке: у перевода категории нет по смыслу
      // (при импорте всё равно уйдёт null), а счёт-получатель есть только у
      // перевода. Иначе переводы попадали в «строк без категории» и раздували
      // счётчик (показывало 20 при одной реально пустой строке).
      const rowType = getEdited(i, 'type', baseValue(ops[i], 'type'))
      // Категория — свойство типа операции: расходную категорию не предлагаем
      // доходным строкам (и наоборот), переводы исключены автоматически.
      if (field === 'categoryId' && rowType !== srcType) continue
      if (field === 'transferAccountId' && rowType !== 'transfer') continue
      const cur = String(getEdited(i, field, baseValue(ops[i], field)))
      if (!cur) emptyIdxs.push(i)
      if (!group || cur === String(value)) continue
      const g = similarGroup(ops[i], field)
      if (g && g.key === group.key) idxs.push(i)
    }
    if (idxs.length || emptyIdxs.length) {
      showBulkModal({ field, value, idxs, emptyIdxs, label: group ? group.label : null })
    }
  }

  // Модалка «применить это же значение к другим строкам?». Раньше это была
  // плашка внизу таблицы — при длинном списке она оставалась за кадром, поэтому
  // спрашиваем окном. Использует штатный openModal в режиме своей разметки.
  let bulkModalOpen = false
  function showBulkModal(b) {
    if (bulkModalOpen) return
    bulkModalOpen = true
    const valueTxt = `${FIELD_LABEL[b.field]}: ${valueLabel(b.field, b.value)}`
    const emptyLabel = b.field === 'accountId' ? 'без счёта'
      : b.field === 'categoryId' ? 'без категории'
      : null
    const choices = []
    if (b.idxs.length) {
      // Основная строка — короткая и всегда влезает; длинная подпись группы
      // (текст операции целиком) едет второй строкой с переносом.
      choices.push({ list: b.idxs, text: 'Похожим операциям', hint: b.label })
    }
    if (emptyLabel && b.emptyIdxs.length) {
      choices.push({ list: b.emptyIdxs, text: `Всем строкам ${emptyLabel}`, hint: null })
    }

    openModal({
      title: 'Применить и к другим строкам?',
      closeLabel: 'Только эта',
      wide: true,
      onClose: () => {
        // Позицию скролла не трогаем: закрытие «Только эта» вообще не должно
        // перерисовывать таблицу. Перерисовка — только после применения.
        bulkModalOpen = false
      },
      body: (host, dialog, close) => {
        host.innerHTML = `
          <p class="modal-text">Применить «<b>${escapeHtml(valueTxt)}</b>»:</p>
          <ul class="modal-choice-list">
            ${choices.map((c, i) => `
              <li>
                <button type="button" class="btn btn-primary modal-choice" data-choice="${i}">
                  <span class="modal-choice-main">${escapeHtml(c.text)} (${c.list.length})</span>
                  ${c.hint ? `<span class="modal-choice-hint" title="${escapeAttr(c.hint)}">${escapeHtml(c.hint)}</span>` : ''}
                </button>
              </li>
            `).join('')}
          </ul>
        `
        host.querySelectorAll('[data-choice]').forEach(btn => {
          btn.addEventListener('click', () => {
            const c = choices[Number(btn.dataset.choice)]
            for (const i of c.list) setEdited(i, { [b.field]: b.value })
            close()
            // renderTable() сам вернёт прокрутку на прежнее место.
            renderTable()
          })
        })
        const first = host.querySelector('[data-choice]')
        if (first) first.focus()
      }
    })
  }

  // Обязательные поля отмеченной к импорту строки:
  //   - счёт-источник — всегда;
  //   - категория — для income/expense (у перевода категории нет по логике);
  //   - счёт-получатель — для перевода.
  // Возвращает список { idx, missing[] } по отмеченным строкам.
  function findInvalidRows() {
    const ops = state.preview?.operations || []
    const invalid = []
    for (let i = 0; i < ops.length; i++) {
      const cb = document.querySelector(`.row-check[data-idx="${i}"]`)
      if (!cb || !cb.checked) continue
      const type = getEdited(i, 'type', baseValue(ops[i], 'type'))
      const missing = []
      if (!getEdited(i, 'accountId', baseValue(ops[i], 'accountId'))) missing.push('account')
      if (type === 'transfer') {
        if (!getEdited(i, 'transferAccountId', baseValue(ops[i], 'transferAccountId'))) missing.push('transferAccount')
      } else if (!getEdited(i, 'categoryId', baseValue(ops[i], 'categoryId'))) {
        missing.push('category')
      }
      if (missing.length) invalid.push({ idx: i, missing })
    }
    return invalid
  }

  // Подсветка невалидных строк + блокировка кнопки импорта. Вызывается после
  // любой правки/отметки, чтобы «Импортировать» нельзя было нажать, пока у всех
  // отмеченных строк не заполнены счёт (и категория для доход/расход).
  function refreshImportState() {
    const invalid = findInvalidRows()
    const invalidIdx = new Set(invalid.map(r => r.idx))
    document.querySelectorAll('#import-table tr[data-idx]').forEach(tr => {
      tr.classList.toggle('row-invalid', invalidIdx.has(Number(tr.dataset.idx)))
    })
    const btn = document.getElementById('import-confirm')
    if (btn) {
      btn.disabled = invalid.length > 0
      btn.title = invalid.length ? 'Заполните счёт и категорию в подсвеченных строках' : ''
    }
    const summary = document.getElementById('import-actions-summary')
    if (summary) {
      // Номера строк — кнопки: по клику прокручиваем к строке и подсвечиваем
      // (в длинной выписке иначе приходится искать вручную). Если незаполненных
      // строк много, показываем первые INVALID_ROWS_MAX, остальные — за кнопкой
      // «… ещё N» (разворачивается по клику, состояние живёт до перерисовки вьюхи).
      if (invalid.length) {
        const visible = invalidExpanded ? invalid : invalid.slice(0, INVALID_ROWS_MAX)
        const hidden = invalid.length - visible.length
        summary.innerHTML = 'Заполните данные: строки ' +
          visible.map(r => `<button type="button" class="row-jump" data-idx="${r.idx}">${r.idx + 1}</button>`).join(', ') +
          (hidden > 0
            ? ` <button type="button" class="row-more" data-action="invalid-toggle">… ещё ${hidden}</button>`
            : (invalidExpanded && invalid.length > INVALID_ROWS_MAX
              ? ' <button type="button" class="row-more" data-action="invalid-toggle">свернуть</button>'
              : ''))
      } else {
        summary.innerHTML = ''
      }
      summary.classList.toggle('import-actions-error', invalid.length > 0)
    }
    schedulePersist()
    return invalid
  }

  // Позиция скролла превью. renderTable() перерисовывает разметку целиком
  // (например, после закрытия модалки bulk-правки), из-за чего список прыгал
  // в начало — сохраняем и возвращаем прокрутку.
  function captureScroll() {
    const wrap = document.querySelector('#import-table .table-wrap')
    const view = document.getElementById('view')
    return {
      wrapTop: wrap ? wrap.scrollTop : 0,
      wrapLeft: wrap ? wrap.scrollLeft : 0,
      viewTop: view ? view.scrollTop : 0
    }
  }

  function restoreScroll(prev) {
    const wrap = document.querySelector('#import-table .table-wrap')
    if (wrap) {
      wrap.scrollTop = prev.wrapTop
      wrap.scrollLeft = prev.wrapLeft
    }
    const view = document.getElementById('view')
    if (view) view.scrollTop = prev.viewTop
  }

  // Переход к строке по клику на её номер в сообщении «Заполните данные: …»:
  // центрируем строку в скролл-контейнере и коротко подсвечиваем.
  function jumpToRow(idx) {
    const row = document.querySelector(`#import-table tr[data-idx="${idx}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('row-flash')
    setTimeout(() => row.classList.remove('row-flash'), 1200)
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

    const prevScroll = captureScroll()
    // Перерисовка убивает кнопку-якорь — открытый список категорий закрываем.
    closePickPopover()

    el.innerHTML = `
      <div class="table-wrap">
        <table class="table table-import">
          <thead>
            <tr>
              <th class="num" style="width:44px">№</th>
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
              const isDup = op.alreadyImported
              // Для уже импортированных строк показываем то, что реально лежит
              // в БД (счёт/категория/вид), иначе дубль выглядел «незаполненным».
              const accountId = getEdited(i, 'accountId', baseValue(op, 'accountId'))
              const transferAccountId = getEdited(i, 'transferAccountId', baseValue(op, 'transferAccountId'))
              const categoryId = getEdited(i, 'categoryId', baseValue(op, 'categoryId'))
              const userComment = getEdited(i, 'userComment', '')
              const type = getEdited(i, 'type', baseValue(op, 'type'))
              const isTransfer = type === 'transfer'
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
                    ? `<span class="badge badge-warn" title="Нет карточных данных (маска/MCC) — распознано частично; вид операции проверьте в колонке «Вид»">без карты</span>`
                    : ''
              // Для дубля показываем только метку «уже в БД»: детали разбора
              // (HOLD/перевод/без карты) для него уже неактуальны.
              const dateBadge = isDup
                ? '<span class="badge badge-warn" title="Операция уже есть в базе — повторно не импортируется. Счёт и категория показаны из БД.">уже в БД</span>'
                : holdBadge
              const saveAsRule = getEdited(i, 'saveAsRule', false)

              // Колонка «Счёт»: для transfer — 2 выбора (источник и получатель)
              // ДРУГ НАД ДРУГОМ с подписями; иначе — 1.
              // Для transfer категория не нужна (показываем прочерк).
              const accountCell = isTransfer ? `
                <div class="transfer-accounts">
                  <div class="transfer-account-row">
                    <span class="transfer-account-label">Списание</span>
                    ${pickButtonHTML(i, 'accountId', accountId, isDup)}
                  </div>
                  <div class="transfer-account-row">
                    <span class="transfer-account-label">Зачисление</span>
                    ${pickButtonHTML(i, 'transferAccountId', transferAccountId, isDup)}
                  </div>
                  <div class="transfer-context" title="Счёт плательщика и счёт получателя по выписке">
                    <span class="hint-muted">${escapeHtml((op.payerAccount || '') + ' → ' + (op.payeeAccount || ''))}</span>
                    ${(op.resolvedAccountId && op.transferAccountId)
                      ? '<span class="badge badge-ok" style="margin-left:4px" title="Счета определены автоматически по номерам из выписки">✓ авто</span>'
                      : (isDup && op.existingAccountId && op.existingTransferAccountId)
                        ? '<span class="badge badge-info" style="margin-left:4px" title="Счета уже сохранённого перевода">в БД</span>'
                        : '<span class="hint-warn" style="margin-left:4px">нет привязки</span>'}
                  </div>
                </div>
              ` : `
                ${pickButtonHTML(i, 'accountId', accountId, isDup)}
                ${op.resolvedAccountId
                  ? '<span class="badge badge-ok" style="margin-left:4px" title="Счёт определён автоматически по номеру из выписки">✓ авто</span>'
                  : isDup && op.existingAccountId
                    ? '<span class="badge badge-info" style="margin-left:4px" title="Счёт из уже сохранённой операции">в БД</span>'
                    : '<span class="hint-warn" style="margin-left:4px">нет привязки</span>'}
              `
              // Категория — для transfer не показываем выбор, только прочерк (там
              // нет категорий по логике перемещения средств между своими счетами).
              // Выбор — кнопкой и всплывающим списком с поиском
              // (см. openPickPopover).
              const categoryCell = isTransfer ? `<span class="hint-muted">—</span>` : `
                ${pickButtonHTML(i, 'categoryId', categoryId, isDup)}
                ${(() => {
                  // «Сохранить как правило» предлагаем, когда строку НЕ покрывает
                  // уже существующее правило (matchedRule) и есть чем матчить
                  // (MCC / merchant / текст операции). Сравнение с
                  // suggestedCategoryId для этого не годится: категория может быть
                  // подставлена по категории банка (тогда matchedRule = null), и
                  // правила при этом нет.
                  const match = ruleMatchFor(op)
                  const showSave = !!(categoryId && match && !op.matchedRule && !isDup)
                  return showSave ? `
                    <label class="hint-warn save-rule">
                      <input type="checkbox" class="row-save-rule" data-idx="${i}" ${saveAsRule ? 'checked' : ''}>
                      Сохранить как правило: ${escapeHtml(match.label)}
                    </label>
                  ` : ''
                })()}
              `

              return `
                <tr class="${rowClass}" data-idx="${i}">
                  <td class="num row-num">${i + 1}</td>
                  <td><input type="checkbox" class="row-check" data-idx="${i}" ${isDup ? '' : (state.checked.get(i) !== false ? 'checked' : '')} ${isDup ? 'disabled' : ''} title="${isDup ? 'Уже импортировано' : 'Импортировать'}"></td>
                  <td>${escapeHtml(op.date)}${dateBadge ? ' ' + dateBadge : ''}</td>
                  <td><code>${escapeHtml(op.mcc || '—')}</code></td>
                  <td class="merchant-cell">${escapeHtml(op.merchantName || op.description || '—')}${ruleBadge ? ' ' + ruleBadge : ''}${op.rawSource ? `
                    <button type="button" class="raw-toggle" data-raw-for="${i}"
                            title="Показать исходные данные строки из файла">
                      <i class="fa fa-file-text-o"></i>
                    </button>` : ''}${isDup ? '' : `
                    <button type="button" class="comment-toggle${userComment.trim() ? ' has-comment' : ''}"
                            data-comment-for="${i}" aria-expanded="false"
                            title="${userComment.trim() ? `Примечание: ${userComment}` : 'Добавить примечание'}">
                      <i class="fa fa-comment-o"></i>
                    </button>`}</td>
                  <td><code>${escapeHtml(op.panMask || '—')}</code></td>
                  <td class="account-cell">${accountCell}</td>
                  <td class="category-cell">${categoryCell}</td>
                  <td class="num num-${type} amount-cell">
                    <span class="amount-value">${type === 'income' ? '+' : ''}${rub(type === 'expense' ? -Math.abs(op.amount) : Math.abs(op.amount))}</span>
                    <button type="button" class="type-toggle" data-idx="${i}" ${isDup ? 'disabled' : ''}
                            title="${isDup ? 'Операция уже в базе — только просмотр' : `Вид операции: ${TYPE_LABEL[type]}. Нажмите, чтобы изменить`}">
                      <i class="fa ${TYPE_ICON[type]}"></i>
                    </button>
                    <select class="row-type" data-idx="${i}" hidden ${isDup ? 'disabled' : ''}>${typeOpts(type)}</select>
                  </td>
                </tr>
                ${!isDup ? `
                  <tr class="row-comment-form" data-comment-row="${i}" hidden>
                    <td colspan="9"><input type="text" class="row-comment" data-idx="${i}" placeholder="Примечание…"
                           title="Своё примечание — сохранится вместе с авто-комментарием банка"></td>
                  </tr>` : ''}
                ${op.rawSource ? `
                  <tr class="row-raw" data-raw-row="${i}" hidden>
                    <td colspan="9"><pre class="raw-source">${escapeHtml(op.rawSource)}</pre></td>
                  </tr>
                ` : ''}
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
    document.getElementById('import-check-all').addEventListener('click', () => { setAllCheckboxes(true); refreshImportState() })
    document.getElementById('import-uncheck-all').addEventListener('click', () => { setAllCheckboxes(false); refreshImportState() })

    // События строк превью.
    el.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', e => {
        state.checked.set(Number(e.target.dataset.idx), e.target.checked)
        refreshImportState()
      })
    })
    // Счёт и категория: кнопка открывает всплывающий список с поиском
    // (у перевода — две кнопки: источник и получатель).
    el.querySelectorAll('.inline-pick').forEach(bindPick)
    el.querySelectorAll('.row-save-rule').forEach(cb => {
      cb.addEventListener('change', e => {
        setEdited(Number(e.target.dataset.idx), { saveAsRule: e.target.checked })
      })
    })
    // Примечание к строке: иконка в колонке Merchant (место не тратим отдельной
    // колонкой), поле открывается отдельной строкой под операцией. Пользовательский
    // текст НЕ подставляем в value при сборке innerHTML (правило проекта — value
    // только через свойство, иначе кавычки в примечании ломали бы разметку).
    // Обработчик ввода — без renderTable: перерисовка отбирала бы фокус.
    el.querySelectorAll('.comment-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = el.querySelector(`tr.row-comment-form[data-comment-row="${btn.dataset.commentFor}"]`)
        if (!row) return
        row.hidden = !row.hidden
        btn.classList.toggle('active', !row.hidden)
        btn.setAttribute('aria-expanded', String(!row.hidden))
        if (!row.hidden) row.querySelector('.row-comment')?.focus()
      })
    })
    el.querySelectorAll('.row-comment').forEach(inp => {
      const idx = Number(inp.dataset.idx)
      inp.value = getEdited(idx, 'userComment', '')
      inp.addEventListener('input', e => {
        const val = e.target.value
        setEdited(Number(e.target.dataset.idx), { userComment: val })
        schedulePersist()
        // Иконка подсвечивается, когда примечание непустое; полный текст — в
        // подсказке. Без перерисовки таблицы, чтобы поле не теряло фокус.
        const toggle = el.querySelector(`.comment-toggle[data-comment-for="${idx}"]`)
        if (toggle) {
          toggle.classList.toggle('has-comment', !!val.trim())
          toggle.title = val.trim() ? `Примечание: ${val}` : 'Добавить примечание'
        }
      })
    })
    // Кнопка «исходные данные из файла»: раскрывает строку с исходным текстом
    // операции (CSV-строка или блок PDF) — чтобы сверить разбор с выпиской.
    el.querySelectorAll('.raw-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const rawRow = el.querySelector(`tr.row-raw[data-raw-row="${btn.dataset.rawFor}"]`)
        if (!rawRow) return
        rawRow.hidden = !rawRow.hidden
        btn.classList.toggle('active', !rawRow.hidden)
      })
    })
    // Иконка вида операции: клик раскрывает select в той же ячейке.
    // Выбор в select применяет тип и перерисовывает таблицу (select снова скрыт).
    el.querySelectorAll('.type-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = btn.closest('.amount-cell')?.querySelector('.row-type')
        if (!sel) return
        sel.hidden = !sel.hidden
        if (!sel.hidden) sel.focus()
      })
    })
    // Вид операции. Смена expense/income ↔ transfer меняет структуру строки
    // (transfer → два счёта и без категории), поэтому перерисовываем таблицу
    // целиком; state.checked/state.edits сохраняют выбор пользователя.
    el.querySelectorAll('.row-type').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = Number(e.target.dataset.idx)
        setEdited(idx, { type: e.target.value })
        offerBulkApply(idx, 'type', e.target.value)
        renderTable()
      })
    })
    document.getElementById('import-confirm').addEventListener('click', doImport)
    // Номера строк в сообщении «Заполните данные: …» — переход к строке.
    // Панель действий пересоздаётся вместе с таблицей, так что слушатель
    // навешивается заново и не дублируется.
    const summaryEl = document.getElementById('import-actions-summary')
    if (summaryEl) {
      summaryEl.addEventListener('click', e => {
        // «… ещё N» / «свернуть» — разворачиваем перечень номеров строк.
        if (e.target.closest('[data-action="invalid-toggle"]')) {
          invalidExpanded = !invalidExpanded
          refreshImportState()
          return
        }
        const jump = e.target.closest('.row-jump')
        if (jump) jumpToRow(Number(jump.dataset.idx))
      })
    }
    refreshImportState()
    restoreScroll(prevScroll)
  }

  // Точечный апдейт ячейки категории: перерисовать кнопку выбора + при
  // необходимости добавить/убрать блок «сохранить как правило».
  // Не трогает остальные строки.
  function updateCategoryCell(idx) {
    // ВАЖНО: el здесь недоступен (в renderTable он локальный) — берём таблицу
    // заново, иначе функция падала с ReferenceError и правка категории не
    // дорисовывалась (в т.ч. не снималась подсветка .row-invalid).
    const table = document.getElementById('import-table')
    const row = table ? table.querySelector(`tr[data-idx="${idx}"]`) : null
    if (!row) return
    const cell = row.querySelector('.category-cell')
    if (!cell) return
    const op = state.preview.operations[idx]
    const categoryId = getEdited(idx, 'categoryId', baseValue(op, 'categoryId'))
    const saveAsRule = getEdited(idx, 'saveAsRule', false)
    // Чекбокс — пока строку не покрывает существующее правило (см. renderTable)
    // и есть чем матчить (MCC / merchant / текст операции).
    const match = ruleMatchFor(op)
    const showSave = !!(categoryId && match && !op.matchedRule && !op.alreadyImported)
    cell.innerHTML = `
      ${pickButtonHTML(idx, 'categoryId', categoryId, op.alreadyImported)}
      ${showSave ? `
        <label class="hint-warn save-rule">
          <input type="checkbox" class="row-save-rule" data-idx="${idx}" ${saveAsRule ? 'checked' : ''}>
          Сохранить как правило: ${escapeHtml(match.label)}
        </label>
      ` : ''}
    `
    // Перенавешиваем обработчики на новые элементы ячейки.
    bindPick(cell.querySelector('.inline-pick'))
    const sr = cell.querySelector('.row-save-rule')
    if (sr) sr.addEventListener('change', e => setEdited(idx, { saveAsRule: e.target.checked }))
    refreshImportState()
  }

  // Всплывающий список категорий с поиском по подстроке прямо у строки.
  // Отдельная модалка избыточна: список не должен уезжать от строки.
  // Панель кладём в document.body с position: fixed — иначе её обрежет
  // overflow: auto у .table-wrap.
  let pickPopover = null

  function onPickPopoverOutside(e) {
    if (!pickPopover) return
    if (pickPopover.contains(e.target)) return
    // Клик по кнопке выбора обрабатывает её собственный обработчик (toggle).
    if (e.target.closest && e.target.closest('.inline-pick')) return
    closePickPopover()
  }
  function onPickPopoverEsc(e) {
    if (e.key === 'Escape') closePickPopover()
  }
  // Прокрутка закрывает список только если она ВНЕ его: прокрутка самого
  // списка категорий (или найденного в нём) — обычное действие пользователя.
  // Иначе панель схлопывалась сразу, как только её пытались листать.
  function onPickPopoverScroll(e) {
    if (!pickPopover) return
    if (e.target === pickPopover || pickPopover.contains(e.target)) return
    closePickPopover()
  }
  function closePickPopover() {
    if (!pickPopover) return
    pickPopover.remove()
    pickPopover = null
    document.removeEventListener('mousedown', onPickPopoverOutside, true)
    document.removeEventListener('keydown', onPickPopoverEsc, true)
    window.removeEventListener('resize', closePickPopover)
    window.removeEventListener('scroll', onPickPopoverScroll, true)
    window.removeEventListener('hashchange', closePickPopover)
  }

  function openPickPopover(idx, btn, field) {
    closePickPopover()
    const op = state.preview?.operations[idx]
    if (!op) return
    const current = String(getEdited(idx, field, baseValue(op, field)) || '')
    // Категории — только своего типа (расходные для расхода, доходные для дохода).
    const options = pickOptions(field, field === 'categoryId' ? rowTypeOf(idx) : null)

    const pop = document.createElement('div')
    // Класс category-select — чтобы поиск получил стиль из ui/modal.js-разметки.
    pop.className = 'category-select inline-pick-popover'
    pop.dataset.idx = String(idx)
    pop.dataset.field = field
    pop.innerHTML = `
      <input type="text" class="category-select-search" placeholder="Поиск…" autocomplete="off">
      <div class="inline-pick-list">
        ${options.map(o => `
          <div class="category-select-option${String(o.value) === String(current) ? ' is-selected' : ''}"
               data-value="${escapeAttr(o.value)}" data-search="${escapeAttr(o.label)}">${o.html}</div>
        `).join('')}
        <div class="inline-pick-empty" hidden>Ничего не найдено</div>
      </div>
    `
    document.body.appendChild(pop)

    // Позиция: под кнопкой, с прижатием к вьюпорту; если снизу мало места —
    // открываем вверх от кнопки.
    const r = btn.getBoundingClientRect()
    const width = Math.max(240, Math.min(320, window.innerWidth - 16))
    pop.style.width = width + 'px'
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px'
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 280 && r.top > spaceBelow) {
      pop.style.bottom = (window.innerHeight - r.top + 2) + 'px'
    } else {
      pop.style.top = (r.bottom + 2) + 'px'
    }
    pickPopover = pop

    const search = pop.querySelector('.category-select-search')
    const items = Array.from(pop.querySelectorAll('.category-select-option'))
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim()
      let visible = 0
      items.forEach(el => {
        const label = (el.dataset.search || '').toLowerCase()
        const show = !q || label.includes(q)
        el.style.display = show ? '' : 'none'
        if (show) visible++
      })
      pop.querySelector('.inline-pick-empty').hidden = visible > 0
    })
    items.forEach(el => {
      el.addEventListener('click', () => {
        const value = el.dataset.value
        closePickPopover()
        applyPick(idx, field, value)
      })
    })
    search.focus()

    document.addEventListener('mousedown', onPickPopoverOutside, true)
    document.addEventListener('keydown', onPickPopoverEsc, true)
    window.addEventListener('resize', closePickPopover)
    window.addEventListener('scroll', onPickPopoverScroll, true)
    // Переход на другую страницу: панель живёт в body, а не во вьюхе.
    window.addEventListener('hashchange', closePickPopover)
  }

  // Применяет выбранное значение (счёт или категорию) и предлагает применить
  // то же к похожим строкам.
  function applyPick(idx, field, value) {
    const op = state.preview?.operations[idx]
    if (!op) return
    if (field === 'categoryId') {
      // Автоматически предлагаем создать правило, если строку не покрывает
      // существующее правило (matchedRule) и есть чем матчить (MCC / merchant /
      // текст операции, см. ruleMatchFor). Снять галочку всё равно можно руками.
      const match = ruleMatchFor(op)
      if (value && !op.matchedRule && match) {
        setEdited(idx, { categoryId: value, saveAsRule: true })
      } else {
        setEdited(idx, { categoryId: value })
      }
      updateCategoryCell(idx)
    } else {
      setEdited(idx, { [field]: value })
      refreshImportState()
    }
    offerBulkApply(idx, field, value)
  }

  async function doImport() {
    const ops = state.preview?.operations || []
    // Кнопка disabled при невалидных строках, но подстрахуемся и здесь
    // (Enter, программный клик, гонка после правки).
    const invalid = refreshImportState()
    if (invalid.length) {
      // В тосте тоже не вываливаем все 200 номеров — первые и «и ещё N».
      const shown = invalid.slice(0, INVALID_ROWS_MAX).map(r => r.idx + 1)
      const more = invalid.length > INVALID_ROWS_MAX ? ` и ещё ${invalid.length - INVALID_ROWS_MAX}` : ''
      toast(`Заполните счёт и категорию: строки ${shown.join(', ')}${more}`, 'error')
      return
    }
    const items = []
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const checked = document.querySelector(`.row-check[data-idx="${i}"]`)?.checked
      if (!checked) continue
      const type = getEdited(i, 'type', baseValue(op, 'type'))
      const isTransfer = type === 'transfer'
      const accountId = getEdited(i, 'accountId', baseValue(op, 'accountId'))
      if (!accountId) {
        toast(`Строка ${i + 1}: выберите счёт-источник`, 'error')
        return
      }
      // Для transfer дополнительно требуется счёт-получатель.
      // Бэкенд сам проверит, что source != target.
      let transferAccountId = null
      if (isTransfer) {
        transferAccountId = getEdited(i, 'transferAccountId', baseValue(op, 'transferAccountId'))
        if (!transferAccountId) {
          toast(`Строка ${i + 1} (перевод): выберите счёт-получатель`, 'error')
          return
        }
      }
      const categoryId = isTransfer ? null : (getEdited(i, 'categoryId', baseValue(op, 'categoryId')) || null)
      const item = {
        externalRef: op.externalRef,
        accountId,
        date: op.date,
        type,
        amount: Math.abs(op.amount),  // знак восстановит backend
        currency: op.currency,
        categoryId,
        mcc: op.mcc,
        merchantName: op.merchantName,
        bankSource: state.bankSource,
        // Примечание пользователя + оригинальная строка выписки: backend
        // склеит первое с авто-комментарием банка и сохранит второе в rawSource.
        userComment: getEdited(i, 'userComment', ''),
        rawSource: op.rawSource || null
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
      if (!save || !categoryId) continue
      // Ключ матча — тот же, что показывала галочка: MCC → merchantName →
      // descriptionRegex (текст операции). Раньше правило писалось ТОЛЬКО по MCC,
      // поэтому у операций без MCC (комиссии, СБП, штрафы, переводы от людей)
      // отмеченная галочка молча ничего не создавала.
      const match = ruleMatchFor(op)
      if (!match) continue
      const key = ruleKey(match.matchType, match.matchValue, accountId)
      if (existingRuleKeys.has(key)) continue // правило уже есть — не дублируем
      try {
        await api.post('/api/import-rules', {
          accountId: accountId || null,
          matchType: match.matchType,
          matchValue: match.matchValue,
          categoryId,
          priority: 100
        })
        existingRuleKeys.add(key)
      } catch (e) {
        // Гонка (правило создано параллельно) — не ошибка импорта операций.
        if (!String(e.message).includes('UNIQUE') && !String(e.message).includes('constraint')) {
          console.warn('не удалось сохранить правило', match.matchType, match.matchValue, e)
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
      // Операции записаны — восстановленное превью больше не нужно.
      state.imported = true
      clearPersistedState()
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

  // Восстанавливаем разобранную выписку после F5: state.bankSource нужен ДО
  // renderShell (активный таб и интро), превью — после (нужны элементы таблицы).
  const restored = restorePersistedState()
  renderShell()
  if (restored) {
    document.getElementById('import-filename').textContent = state.fileName
    renderSummary()
    renderTable()
  }
}
