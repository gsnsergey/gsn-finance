// Generic list view для deposits / holdings / loans / subscriptions / obligations.

import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'
import { BANKS, bankLabel } from '../data/banks.js'
import { CURRENCIES } from '../data/currencies.js'

// Знак валюты по ISO-коду для рендера цен (₽, $, €, …). Для неизвестных кодов — пусто.
const SYMBOL_BY_CODE = Object.fromEntries(CURRENCIES.map(c => [c.value, c.symbol || '']))
const currencySign = code => SYMBOL_BY_CODE[code] || ''

// Колонка «Валюта» показывает ISO-код (RUB, USD) вместо длинного названия.
const currencyCode = code => code || '—'
import { BROKERS, brokerLabel } from '../data/brokers.js'
import { LOAN_TYPES, loanTypeLabel } from '../data/loanTypes.js'
import { ASSET_TYPES, assetTypeLabel } from '../data/assetTypes.js'
import { categoryIconHTML } from '../data/categoryIcons.js'
import { brokerAccounts } from '../data/brokerAccounts.js'

// Маппер код→русская подпись для периодов подписок и обязательств.
// Используется и в колонках таблиц (render), и в опциях select-полей в формах.
const PERIOD_LABELS = {
  monthly: 'Ежемесячно',
  quarterly: 'Ежеквартально',
  yearly: 'Ежегодно',
  weekly: 'Еженедельно',
  daily: 'Ежедневно'
}
const periodLabel = v => PERIOD_LABELS[v] || v || '—'

const COL_DATE = () => ({ render: v => v })

// Рендеры для портфеля: цены (4 знака), суммы (2 знака + ₽), прибыль (с +/− и цветом).
const num4 = v => (v == null ? '—' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const num2 = v => (v == null ? '—' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const profitRender = v => {
  if (v == null) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '')
  const cls = n > 0 ? 'profit-pos' : (n < 0 ? 'profit-neg' : '')
  return `<span class="${cls}">${sign}${Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
}
const pctRender = v => {
  if (v == null) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '')
  const cls = n > 0 ? 'profit-pos' : (n < 0 ? 'profit-neg' : '')
  return `<span class="${cls}">${sign}${Math.abs(n).toFixed(2)}%</span>`
}

// Рендеры с символом валюты (для портфеля): принимают (value, row),
// в row.currency — ISO-код валюты. Подпись currencySign(code) → '₽', '$', …
// NB: между числом и знаком — неразрывный пробел (U+00A0), чтобы «91,10 ₽»
// не разрывалось между строк при узкой колонке.
const NBSP = ' '
const num4Cur = (v, r) => {
  if (v == null) return '—'
  const n = Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return `${n}${NBSP}${currencySign(r?.currency)}`
}
const num2Cur = (v, r) => {
  if (v == null) return '—'
  const n = Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n}${NBSP}${currencySign(r?.currency)}`
}
const profitCur = (v, r) => {
  if (v == null) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '')
  const cls = n > 0 ? 'profit-pos' : (n < 0 ? 'profit-neg' : '')
  return `<span class="${cls}">${sign}${Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NBSP}${currencySign(r?.currency)}</span>`
}

const CONFIGS = {
  deposits: {
    title: 'Вклады',
    addTitle: 'Новый вклад',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'bank', label: 'Банк', render: bankLabel },
      { key: 'rate', label: 'Ставка, %', render: v => `${v}%` },
      { key: 'openedAt', label: 'Открыт', ...COL_DATE() },
      { key: 'capitalization', label: 'Капитализация', render: v => v ? 'да' : 'нет' },
      { key: 'currentBalance', label: 'Текущий баланс', render: rub, num: true }
    ],
    sumKey: 'currentBalance',
    addFields: () => [
      { name: 'bank', label: 'Банк', type: 'combobox', required: true, placeholder: 'начни вводить или выберите', options: BANKS },
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Накопительный' },
      { name: 'principal', label: 'Начальная сумма (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      { name: 'rate', label: 'Годовая ставка, %', type: 'number', required: true, step: '0.01', placeholder: '8' },
      { name: 'openedAt', label: 'Дата открытия', type: 'date', required: true, value: todayIso() },
      { name: 'currentBalance', label: 'Текущий баланс (₽)', type: 'number', step: '0.01', placeholder: 'равно начальной сумме', kopecks: true },
      {
        name: 'payoutFrequency', label: 'Выплата процентов', type: 'select', required: true, value: 'end',
        options: [
          { value: 'end', label: 'В конце срока' },
          { value: 'monthly', label: 'Ежемесячно' },
          { value: 'quarterly', label: 'Ежеквартально' }
        ]
      },
      { name: 'capitalization', label: 'С капитализацией', type: 'checkbox' },
      { name: 'closedAt', label: 'Дата закрытия (если закрыт)', type: 'date' }
    ]
  },

  holdings: {
    title: 'Портфель',
    addTitle: 'Новая позиция',
    columns: [
      { key: 'broker', label: 'Брокер', render: brokerLabel },
      { key: 'account', label: 'Счёт/Пакет' },
      { key: 'type', label: 'Тип', render: assetTypeLabel },
      { key: 'ticker', label: 'Тикер' },
      { key: 'name', label: 'Название' },
      { key: 'quantity', label: 'Кол-во', num: true },
      { key: 'avgBuyPrice', label: 'Цена покупки', render: num4Cur, num: true },
      { key: 'currentPrice', label: 'Текущая', render: num4Cur, num: true },
      { key: 'currentValue', label: 'Стоимость', render: num2Cur, num: true },
      { key: 'profit', label: 'Прибыль', render: profitCur, num: true },
      { key: 'profitPct', label: '%', render: pctRender, num: true }
    ],
    sumKey: 'currentValue',
    // Кнопка «Обновить»: дёргает внешний эндпоинт (Т-Инвестиции),
    // после чего таблица перерисовывается из /api/holdings.
    refresh: {
      label: 'Обновить',
      endpoint: '/api/holdings/import/tinvest',
      method: 'POST',
      body: {},
      successMessage: 'Портфель обновлён'
    },
    // Клиентские фильтры над таблицей (брокер / счёт / тип / валюта).
    // Опции селектов собираются из уникальных значений в строках.
    // Каскадных зависимостей нет (account не зависит от broker).
    // `valueRender` (опц.) — функция (v, row) => string для человекочитаемого
    // лейбла в дропдауне (например, assetTypeLabel превращает 'stock' в 'Акция').
    filters: [
      { key: 'broker', label: 'Брокер', valueRender: brokerLabel },
      { key: 'account', label: 'Счёт/Пакет' },
      { key: 'type', label: 'Тип', valueRender: assetTypeLabel },
      { key: 'currency', label: 'Валюта' }
    ],
    // Мини-дашборд над таблицей: агрегаты по группам ключей (broker / account).
    // Каждая группа — отдельная карточка с метриками из строк.
    dashboard: [
      {
        groupBy: 'broker',
        title: 'По брокерам',
        valueRender: brokerLabel,
        // Метрики: (rows: позиции группы) => массив { label, value }
        // value можно сразу HTML (как rub(...) для денег).
        metrics: (rows) => [
          { label: 'Позиций', value: String(rows.length) },
          { label: 'Стоимость', value: rub(rows.reduce((s, r) => s + (r.currentValue || 0), 0)) },
          { label: 'Прибыль', value: rub(rows.reduce((s, r) => s + (r.profit || 0), 0)) }
        ]
      },
      {
        groupBy: 'account',
        title: 'По счетам/пакетам',
        metrics: (rows) => [
          { label: 'Позиций', value: String(rows.length) },
          { label: 'Стоимость', value: rub(rows.reduce((s, r) => s + (r.currentValue || 0), 0)) },
          { label: 'Прибыль', value: rub(rows.reduce((s, r) => s + (r.profit || 0), 0)) }
        ]
      }
    ],
    // Переключатель режима отображения: «Таблица» / «Дерево».
    // Состояние сохраняется в localStorage по ключу viewMode.storageKey.
    viewMode: {
      modes: ['table', 'tree'],
      default: 'table',
      storageKey: 'holdings.viewMode',
      label: 'Вид'
    },
    // Конфиг древовидного режима (если viewMode включает 'tree').
    tree: {
      // Уровни: первый — корень (брокер), второй — счёт/пакет, третий — позиции.
      levels: ['broker', 'account'],
      // Заголовок группы: (key, levelMeta) => { label, html?, hint? }
      // label — основной текст; hint — мелкий текст справа.
      groupTitle: (key, level) => {
        if (level === 'broker') return { label: brokerLabel(key) }
        return { label: key || '— Без счёта —' }
      },
      // Метрики группы (rows — позиции в этой ветке).
      groupMetrics: (rows) => [
        { label: 'позиций', value: String(rows.length) },
        { label: 'стоимость', value: rub(rows.reduce((s, r) => s + (r.currentValue || 0), 0)) },
        { label: 'прибыль', value: rub(rows.reduce((s, r) => s + (r.profit || 0), 0)) }
      ]
    },
    addFieldsAsync: async () => {
      const accounts = await api.get('/api/accounts')
      // Список пакетов привязан к брокеру. Подгружаем из справочника, но пользователь
      // может вписать своё — поле остаётся текстовым, а ниже в onMount подменим
      // предложения (suggestions) на пакеты выбранного брокера.
      const baseAccountSuggestions = brokerAccounts(null)
      return [
        { name: 'broker', label: 'Брокер', type: 'combobox', required: true, placeholder: 'начни вводить или выберите', options: BROKERS },
        {
          name: 'account', label: 'Счёт/Пакет у брокера', type: 'text',
          placeholder: 'например: ИИС, Основной, Премиум',
          suggestions: baseAccountSuggestions,
          brokerBound: true
        },
        {
          name: 'type', label: 'Тип актива', type: 'select', required: true, value: 'stock',
          options: ASSET_TYPES
        },
        { name: 'ticker', label: 'Тикер', type: 'text', required: true, placeholder: 'SBER' },
        { name: 'name', label: 'Название (опционально)', type: 'text', placeholder: 'Сбербанк' },
        // В портфеле количество и цены хранятся с точностью до 4 знаков — это
        // стандартный шаг цены/лота у большинства брокеров (дробные акции, ETF).
        { name: 'quantity', label: 'Количество', type: 'number', required: true, step: '0.0001' },
        { name: 'avgBuyPrice', label: 'Цена покупки', type: 'number', required: true, step: '0.0001', placeholder: 'средняя цена входа' },
        { name: 'currentPrice', label: 'Текущая цена', type: 'number', step: '0.0001', placeholder: 'если не указана — равна цене покупки' },
        { name: 'currency', label: 'Валюта', type: 'combobox', placeholder: 'RUB', options: CURRENCIES, value: 'RUB' },
        {
          name: 'accountId', label: 'Банковский счёт (опционально)', type: 'select',
          options: [{ value: '', label: '— не привязан —' }, ...accounts.map(a => ({ value: a.id, label: a.name }))]
        }
      ]
    },
    onMount: (dialog, ctx) => {
      // Привязка «Счёт/Пакет у брокера» к выбранному брокеру: когда меняется broker,
      // обновляем datalist с пакетами выбранного брокера. Пользователь может и вписать
      // своё — поле остаётся свободным для ввода.
      const brokerEl = dialog.querySelector('[name="broker"]')
      const accountEl = dialog.querySelector('[name="account"]')
      if (!brokerEl || !accountEl) return
      const applyBroker = () => {
        const id = accountEl.id || accountEl.getAttribute('list')?.replace(/^dl-/, '')
        if (!id) return
        const dl = dialog.querySelector(`#dl-${id}`)
        if (!dl) return
        const list = brokerAccounts(brokerEl.value)
        dl.innerHTML = list.map(s => `<option value="${s.replace(/"/g, '&quot;')}">`).join('')
      }
      brokerEl.addEventListener('change', applyBroker)
      // combobox скрытый input — слушаем его change
      brokerEl.addEventListener('input', applyBroker)
      applyBroker()
    }
  },

  loans: {
    title: 'Кредиты',
    addTitle: 'Новый кредит',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'bank', label: 'Банк', render: bankLabel },
      { key: 'type', label: 'Тип', render: loanTypeLabel },
      { key: 'rate', label: 'Ставка, %', render: v => `${v}%` },
      { key: 'monthlyPayment', label: 'Платёж/мес', render: rub, num: true },
      { key: 'paymentDay', label: 'День' },
      { key: 'remainingAmount', label: 'Остаток', render: rub, num: true }
    ],
    sumKey: 'remainingAmount',
    addFields: () => [
      { name: 'bank', label: 'Банк', type: 'combobox', required: true, placeholder: 'начни вводить или выберите', options: BANKS },
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Потреб' },
      {
        name: 'type', label: 'Тип', type: 'select', required: true,
        options: LOAN_TYPES
      },
      { name: 'principal', label: 'Начальная сумма (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      { name: 'remainingAmount', label: 'Текущий остаток (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      { name: 'rate', label: 'Годовая ставка, %', type: 'number', required: true, step: '0.01' },
      { name: 'monthlyPayment', label: 'Ежемесячный платёж (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      { name: 'paymentDay', label: 'День платежа (1–31)', type: 'number', required: true, min: 1, max: 31, integer: true },
      { name: 'openedAt', label: 'Дата открытия', type: 'date', required: true, value: todayIso() },
      { name: 'closedAt', label: 'Плановая дата закрытия', type: 'date' }
    ]
  },

  subscriptions: {
    title: 'Подписки',
    addTitle: 'Новая подписка',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'amount', label: 'Сумма', render: rub, num: true },
      { key: 'period', label: 'Период', render: periodLabel },
      { key: 'nextChargeDate', label: 'Следующий платёж', ...COL_DATE() },
      { key: 'active', label: 'Активна', render: v => v ? 'да' : 'нет' }
    ],
    addFieldsAsync: async () => {
      const cats = await api.get('/api/categories')
      return [
        { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Яндекс Плюс' },
        { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
        {
          name: 'period', label: 'Период', type: 'select', required: true,
          options: Object.entries(PERIOD_LABELS)
            .filter(([k]) => ['monthly', 'yearly', 'weekly'].includes(k))
            .map(([value, label]) => ({ value, label }))
        },
        { name: 'nextChargeDate', label: 'Следующий платёж', type: 'date', required: true, value: todayIso() },
        {
          name: 'categoryId', label: 'Категория (опционально)', type: 'category-select',
          options: [
            { value: '', label: '— нет —', html: '— нет —' },
            ...cats.map(c => ({
              value: c.id,
              label: c.name,
              html: `${categoryIconHTML(c.icon)} ${escapeHtml(c.name)}`
            }))
          ]
        },
        { name: 'active', label: 'Активна', type: 'checkbox', value: true }
      ]
    }
  },

  obligations: {
    title: 'Обязательства',
    addTitle: 'Новое обязательство',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'recipient', label: 'Получатель' },
      { key: 'amount', label: 'Сумма', render: rub, num: true },
      { key: 'period', label: 'Период', render: periodLabel },
      { key: 'nextDueDate', label: 'Следующий', ...COL_DATE() }
    ],
    addFields: () => [
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Аренда' },
      { name: 'recipient', label: 'Получатель', type: 'text', placeholder: 'Иванов' },
      { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      {
        name: 'period', label: 'Период', type: 'select', required: true,
        options: Object.entries(PERIOD_LABELS)
          .filter(([k]) => ['monthly', 'quarterly', 'yearly'].includes(k))
          .map(([value, label]) => ({ value, label }))
      },
      { name: 'nextDueDate', label: 'Следующий срок', type: 'date', required: true, value: todayIso() },
      { name: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'За что' }
    ]
  }
}

export function makeListView(endpoint) {
  async function render(root) {
    const cfg = CONFIGS[endpoint]
    const rows = await api.get(`/api/${endpoint}`)

    if (rows.length === 0) {
      root.innerHTML = `
        <div class="page-actions">
          <button class="btn btn-primary" id="add-btn">+ Добавить</button>
        </div>
        <div class="empty">
          <div class="empty-title">Пока пусто</div>
          Нажми «+ Добавить», чтобы создать первую запись.<br>
          Или через CLI:<br>
          <code>${getCliHint(endpoint)}</code>
        </div>`
      wireFormButton(root, cfg, endpoint, null, render)
      return
    }

    const hasAdd = !!(cfg.addFields || cfg.addFieldsAsync)
    const hasRefresh = !!cfg.refresh
    const hasViewMode = !!cfg.viewMode

    // Состояние view-mode (если задан). Сохраняется в localStorage.
    const viewModeState = { mode: cfg.viewMode?.default || 'table' }
    if (hasViewMode) {
      try {
        const saved = localStorage.getItem(cfg.viewMode.storageKey)
        if (saved && cfg.viewMode.modes.includes(saved)) viewModeState.mode = saved
      } catch { /* localStorage может быть недоступен (SSR / приватный режим) */ }
    }

    // Переключатель режима (Таблица / Дерево) слева на тулбаре.
    const viewModeHtml = hasViewMode ? `
      <div class="view-mode-toggle" role="group" aria-label="${escapeHtml(cfg.viewMode.label || 'Вид')}">
        ${cfg.viewMode.modes.map(m => {
          const labels = { table: 'Таблица', tree: 'Дерево' }
          return `<button class="btn btn-sm view-mode-btn${viewModeState.mode === m ? ' active' : ''}" data-view-mode="${m}">${escapeHtml(labels[m] || m)}</button>`
        }).join('')}
      </div>` : ''

    // Панель действий: добавить (если есть) + обновить (если есть).
    // Раньше тут был только «+ Добавить», теперь — два варианта.
    const actionsHtml = (hasAdd || hasRefresh) ? `
      <div class="page-actions">
        ${hasRefresh ? `<button class="btn" id="refresh-btn">↻ ${escapeHtml(cfg.refresh.label)}</button>` : ''}
        ${hasAdd ? `<button class="btn btn-primary" id="add-btn">+ Добавить</button>` : ''}
      </div>` : ''

    // Тулбар: слева переключатель режима (если есть), справа действия.
    // Если переключателя нет — оставляем как раньше (только actionsHtml).
    const toolbarHtml = hasViewMode
      ? `<div class="page-toolbar">${viewModeHtml}${actionsHtml}</div>`
      : actionsHtml

    // Текущие значения фильтров (хранится в замыкании, чтобы при изменении
    // перерисовать только таблицу, не дёргать API).
    const filters = cfg.filters ? cfg.filters.map(f => ({ ...f, value: '' })) : []

    function getFilteredRows() {
      return rows.filter(r =>
        filters.every(f => !f.value || String(r[f.key] ?? '') === f.value)
      )
    }

    // Развёрнутые ветки дерева (по строковому ключу пути). По умолчанию
    // все развёрнуты — пользователь сворачивает, что ему не нужно.
    const treeExpanded = new Set()

    function buildTree(levels, rows) {
      // Возвращает массив { key: path, level: 0..n-1, label, metricsRows, children: [...] }
      const buildLevel = (levelIdx, parentRows) => {
        if (levelIdx >= levels.length) {
          // Листья — это позиции. Каждая позиция = отдельный «узел-лист».
          return parentRows.map(r => ({ kind: 'leaf', row: r }))
        }
        const key = levels[levelIdx]
        const groups = new Map()
        for (const r of parentRows) {
          const v = r[key] ?? '—'
          if (!groups.has(v)) groups.set(v, [])
          groups.get(v).push(r)
        }
        return [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([groupKey, groupRows]) => ({
          kind: 'group',
          level: levelIdx,
          key: String(groupKey),
          rows: groupRows,
          children: buildLevel(levelIdx + 1, groupRows)
        }))
      }
      return buildLevel(0, rows)
    }

    function treePath(node) {
      // Собираем путь к узлу; используется как ключ для expanded Set.
      // Для узлов группы путь — это просто groupKey на текущем уровне
      // (между разными уровнями коллизий нет, т. к. key строчной).
      return node.kind === 'group' ? `g${node.level}:${node.key}` : `l:${node.row.id}`
    }

    function renderTreeNode(node) {
      if (node.kind === 'leaf') {
        // Позиция — компактная строка с основными полями.
        const r = node.row
        return `<div class="tree-leaf" data-id="${escapeHtml(r.id)}">
          <span class="tree-leaf-ticker">${escapeHtml(r.ticker || '')}</span>
          <span class="tree-leaf-name">${escapeHtml(r.name || '')}</span>
          <span class="tree-leaf-qty">${escapeHtml(String(r.quantity ?? 0))}</span>
          <span class="tree-leaf-value num">${r.currentValue != null ? rub(r.currentValue) : '—'}</span>
          <span class="tree-leaf-profit num">${r.profit != null ? rub(r.profit) : '—'}</span>
        </div>`
      }
      // Группа — кликабельный заголовок + (если развёрнута) дети.
      const path = treePath(node)
      const isOpen = treeExpanded.has(path)
      const title = cfg.tree.groupTitle ? cfg.tree.groupTitle(node.key, node.level) : { label: node.key }
      const metrics = cfg.tree.groupMetrics ? cfg.tree.groupMetrics(node.rows) : []
      return `
        <div class="tree-group" data-path="${escapeHtml(path)}">
          <div class="tree-group-header${isOpen ? ' open' : ''}" data-toggle="${escapeHtml(path)}">
            <span class="tree-caret">${isOpen ? '▼' : '▶'}</span>
            <span class="tree-group-label">${escapeHtml(title.label || node.key)}</span>
            <span class="tree-group-metrics">${metrics.map(m =>
              `<span class="tree-group-metric"><span class="muted">${escapeHtml(m.label)}:</span> ${m.value}</span>`
            ).join('')}</span>
          </div>
          ${isOpen ? `<div class="tree-group-children">${node.children.map(renderTreeNode).join('')}</div>` : ''}
        </div>
      `
    }

    function renderTreeSection() {
      const filtered = getFilteredRows()
      const dashboard = (cfg.dashboard || []).map(section => {
        const groups = new Map()
        for (const r of filtered) {
          const key = r[section.groupBy] ?? '—'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(r)
        }
        const cards = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => {
          const titleRaw = section.valueRender ? section.valueRender(key) : key
          return `<div class="dashboard-card">
            <div class="dashboard-card-title">${escapeHtml(String(titleRaw))}</div>
            ${section.metrics(rows).map(m => `
              <div class="dashboard-metric">
                <span class="dashboard-metric-label">${escapeHtml(m.label)}</span>
                <span class="dashboard-metric-value">${m.value}</span>
              </div>
            `).join('')}
          </div>`
        }).join('')
        return `<div class="dashboard-section">
          <div class="dashboard-section-title">${escapeHtml(section.title)}</div>
          <div class="dashboard-cards">${cards}</div>
        </div>`
      }).join('')

      // Опции фильтров — уникальные значения из исходных (нефильтрованных) строк.
      const filtersBar = filters.length > 0 ? `
        <div class="filters-bar">
          ${filters.map(f => {
            const uniq = [...new Set(rows.map(r => r[f.key]).filter(v => v !== null && v !== undefined && v !== ''))]
            const opts = ['<option value="">Все</option>']
              .concat(uniq.sort().map(v => {
                const rawV = String(v)
                const displayV = f.valueRender ? escapeHtml(f.valueRender(v)) : escapeHtml(rawV)
                return `<option value="${escapeHtml(rawV)}"${f.value === rawV ? ' selected' : ''}>${displayV}</option>`
              }))
            return `<label class="filter"><span>${escapeHtml(f.label)}</span><select data-filter-key="${escapeHtml(f.key)}">${opts.join('')}</select></label>`
          }).join('')}
          ${filters.some(f => f.value) ? `<button class="btn btn-sm" id="filters-reset">Сбросить</button>` : ''}
        </div>` : ''

      // Строим дерево
      const treeNodes = buildTree(cfg.tree.levels, filtered)
      // По умолчанию разворачиваем все группы (первый рендер дерева).
      if (treeExpanded.size === 0) {
        const walk = (nodes, prefix = '') => {
          for (const n of nodes) {
            if (n.kind === 'group') {
              treeExpanded.add(`${prefix}g${n.level}:${n.key}`)
              walk(n.children, `${prefix}g${n.level}:${n.key}:`)
            }
          }
        }
        walk(treeNodes)
      }

      const treeHtml = filtered.length === 0 ? `
        <div class="empty">
          <div class="empty-title">Нет позиций по фильтру</div>
          Попробуйте сбросить фильтры или изменить условия.
        </div>` : `
        <div class="tree-wrap">
          ${treeNodes.map(renderTreeNode).join('')}
        </div>`

      const html = `${dashboard}${filtersBar}${treeHtml}`

      const existing = root.querySelector('.table-section')
      if (existing) {
        existing.innerHTML = html
      } else {
        const div = document.createElement('div')
        div.className = 'table-section'
        div.innerHTML = html
        root.appendChild(div)
      }

      // Обработчики фильтров (те же, что в таблице)
      root.querySelectorAll('select[data-filter-key]').forEach(sel => {
        sel.addEventListener('change', () => {
          const f = filters.find(x => x.key === sel.dataset.filterKey)
          if (f) f.value = sel.value
          // Сбрасываем expanded при смене фильтра — иначе часть групп может
          // исчезнуть, а часть expanded-флагов останется «висеть» в Set.
          treeExpanded.clear()
          renderSection()
        })
      })
      const resetBtn = root.querySelector('#filters-reset')
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          filters.forEach(f => f.value = '')
          treeExpanded.clear()
          renderSection()
        })
      }

      // Обработчики раскрытия групп
      root.querySelectorAll('[data-toggle]').forEach(el => {
        el.addEventListener('click', () => {
          const p = el.dataset.toggle
          if (treeExpanded.has(p)) treeExpanded.delete(p)
          else treeExpanded.add(p)
          renderTreeSection()
        })
      })
    }

    function renderTableSection() {
      const filtered = getFilteredRows()
      const total = cfg.sumKey ? filtered.reduce((s, r) => s + (r[cfg.sumKey] || 0), 0) : null

      // Мини-дашборд (если задан) — агрегаты по группам. Считается по
      // ОТФИЛЬТРОВАННЫМ строкам, чтобы итоги согласовались с таблицей ниже.
      const dashboard = (cfg.dashboard || []).map(section => {
        const groups = new Map()
        for (const r of filtered) {
          const key = r[section.groupBy] ?? '—'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(r)
        }
        const cards = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => {
          const titleRaw = section.valueRender ? section.valueRender(key) : key
          return `<div class="dashboard-card">
            <div class="dashboard-card-title">${escapeHtml(String(titleRaw))}</div>
            ${section.metrics(rows).map(m => `
              <div class="dashboard-metric">
                <span class="dashboard-metric-label">${escapeHtml(m.label)}</span>
                <span class="dashboard-metric-value">${m.value}</span>
              </div>
            `).join('')}
          </div>`
        }).join('')
        return `<div class="dashboard-section">
          <div class="dashboard-section-title">${escapeHtml(section.title)}</div>
          <div class="dashboard-cards">${cards}</div>
        </div>`
      }).join('')

      // Опции фильтров — уникальные значения из исходных (нефильтрованных) строк.
      // Если фильтровать каскадно (account зависит от broker), нужно передавать
      // текущий выбор и фильтровать опции; сейчас каскада нет — берём все.
      const filtersBar = filters.length > 0 ? `
        <div class="filters-bar">
          ${filters.map(f => {
            const uniq = [...new Set(rows.map(r => r[f.key]).filter(v => v !== null && v !== undefined && v !== ''))]
            const opts = ['<option value="">Все</option>']
              .concat(uniq.sort().map(v => {
                const rawV = String(v)
                const displayV = f.valueRender ? escapeHtml(f.valueRender(v)) : escapeHtml(rawV)
                return `<option value="${escapeHtml(rawV)}"${f.value === rawV ? ' selected' : ''}>${displayV}</option>`
              }))
            return `<label class="filter"><span>${escapeHtml(f.label)}</span><select data-filter-key="${escapeHtml(f.key)}">${opts.join('')}</select></label>`
          }).join('')}
          ${filters.some(f => f.value) ? `<button class="btn btn-sm" id="filters-reset">Сбросить</button>` : ''}
        </div>` : ''

      // Контейнер для таблицы — отдельный, чтобы можно было его перерисовать
      // при изменении фильтра без полного пересоздания DOM (экономим обработчики).
      const tableHtml = filtered.length === 0 ? `
        <div class="empty">
          <div class="empty-title">Нет строк по фильтру</div>
          Попробуйте сбросить фильтры или изменить условия.
        </div>` : `
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              ${cfg.columns.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}
              <th style="width:80px"></th>
            </tr></thead>
            <tbody>
              ${filtered.map(r => `
                <tr>
                  ${cfg.columns.map(c => {
                    const v = r[c.key]
                    // render-функции получают (value, row) — старые игнорируют row,
                    // новые (num4Cur/profitCur/…) читают row.currency для символа валюты.
                    const rendered = c.render ? c.render(v, r) : (v ?? '')
                    return `<td class="${c.num ? 'num' : ''}">${rendered}</td>`
                  }).join('')}
                  <td>
                    <div class="row-actions">
                      <button class="btn btn-sm" data-action="edit" data-id="${r.id}" title="Редактировать">✎</button>
                      <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}" title="Удалить">×</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
              ${total !== null ? `<tr style="font-weight:600;background:rgba(0,0,0,0.02)">
                <td colspan="${cfg.columns.length - 1}">Итого</td>
                <td class="num">${rub(total)}</td>
                <td></td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>`

      // Контейнер table-section — обёртка над dashboard + filters-bar + table-wrap/empty,
      // чтобы при изменении фильтра перерисовать только её (один querySelector
      // на .table-section, а не root.innerHTML = …).
      const existing = root.querySelector('.table-section')
      const html = `${dashboard}${filtersBar}${tableHtml}`
      if (existing) {
        existing.innerHTML = html
      } else {
        const div = document.createElement('div')
        div.className = 'table-section'
        div.innerHTML = html
        root.appendChild(div)
      }

      // Навешиваем обработчики фильтров и кнопки «Сбросить» после каждой отрисовки.
      root.querySelectorAll('select[data-filter-key]').forEach(sel => {
        sel.addEventListener('change', () => {
          const f = filters.find(x => x.key === sel.dataset.filterKey)
          if (f) f.value = sel.value
          renderSection()
        })
      })
      const resetBtn = root.querySelector('#filters-reset')
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          filters.forEach(f => f.value = '')
          renderSection()
        })
      }
    }

    root.innerHTML = `${toolbarHtml}`
    wireFormButton(root, cfg, endpoint, null, render)
    wireRefreshButton(root, cfg, render)

    // Переключатель режима (Таблица / Дерево).
    root.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.viewMode
        if (!cfg.viewMode.modes.includes(m)) return
        viewModeState.mode = m
        try { localStorage.setItem(cfg.viewMode.storageKey, m) } catch {}
        // Обновить подсветку активной кнопки
        root.querySelectorAll('.view-mode-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.viewMode === m)
        })
        renderSection()
      })
    })

    // renderSection выбирает таблицу или дерево по viewModeState.mode
    // и обновляет содержимое .table-section (не весь root).
    function renderSection() {
      if (viewModeState.mode === 'tree' && cfg.tree) {
        renderTreeSection()
      } else {
        renderTableSection()
      }
    }

    renderSection()

    root.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Ищем в исходных rows, не в filtered — иначе после фильтра
        // нельзя было бы отредактировать скрытые строки.
        const record = rows.find(r => r.id === btn.dataset.id)
        if (record) wireFormButton(root, cfg, endpoint, record, render)
      })
    })

    root.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить запись?')) return
        try {
          await api.del(`/api/${endpoint}/${btn.dataset.id}`)
          toast('Удалено', 'success')
          render(root)
        } catch (e) { toast(e.message, 'error') }
      })
    })
  }
  return render
}

// Кнопка «+ Добавить» (record=null) или «Редактировать» (record=...)
function wireFormButton(root, cfg, endpoint, record, render) {
  const isEdit = !!record
  const btn = document.getElementById('add-btn')

  // Если вызвали напрямую из edit-handler (без кнопки), btn может отсутствовать
  if (!isEdit && !btn) return
  if (isEdit) {
    // открываем форму сразу
    openForm(root, cfg, endpoint, record, render)
    return
  }
  btn.addEventListener('click', () => openForm(root, cfg, endpoint, null, render))
}

// Кнопка «Обновить» — дёргает внешний эндпоинт и перерисовывает список.
// Используется для портфеля: refresh → POST /api/holdings/import/tinvest
// (тянет свежие цены из Т-Инвестиций), затем GET /api/holdings + rerender.
function wireRefreshButton(root, cfg, render) {
  if (!cfg.refresh) return
  const btn = document.getElementById('refresh-btn')
  if (!btn) return

  const { label, endpoint, method = 'POST', body = {}, successMessage } = cfg.refresh

  btn.addEventListener('click', async () => {
    if (btn.disabled) return
    btn.disabled = true
    const prevText = btn.textContent
    btn.textContent = '↻ Обновление…'
    try {
      await api[method.toLowerCase()](endpoint, body)
      toast(successMessage || 'Обновлено', 'success')
      await render(root)
    } catch (e) {
      // 400 missing_token / 500 tinvest_error и т. п. — показываем пользователю.
      toast(e.message || 'Не удалось обновить', 'error')
      btn.disabled = false
      btn.textContent = prevText
    }
    // В success ветке render пересоздаст DOM и кнопку — disabled снимется автоматически.
  })
}

async function openForm(root, cfg, endpoint, record, render) {
  let fields
  try {
    fields = cfg.addFieldsAsync ? await cfg.addFieldsAsync() : cfg.addFields()
  } catch (e) {
    toast('Не удалось подготовить форму: ' + e.message, 'error')
    return
  }

  // Подставляем текущие значения записи
  if (record) {
    fields = fields.map(f => {
      const v = record[f.name]
      if (v === undefined || v === null) return f
      // копейки → рубли (форма работает в рублях)
      if (f.kopecks) return { ...f, value: Number(v) / 100 }
      return { ...f, value: v }
    })
  }

  openModal({
    title: isEditStr(record, cfg),
    submitLabel: record ? 'Сохранить' : 'Создать',
    fields,
    onMount: typeof cfg.onMount === 'function'
      ? (dialog) => cfg.onMount(dialog, { fields, record })
      : undefined,
    onSubmit: async (data) => {
      const body = {}
      for (const [k, v] of Object.entries(data)) {
        if (v === '' || v === null) continue
        const f = fields.find(x => x.name === k)
        if (f && f.kopecks) {
          body[k] = Math.round(Number(v) * 100)
        } else if (f && f.type === 'checkbox') {
          body[k] = v ? 1 : 0
        } else if (f && f.type === 'number') {
          body[k] = f.integer ? Math.round(Number(v)) : Number(v)
        } else {
          body[k] = v
        }
      }
      // Дефолты для опциональных полей
      if (endpoint === 'deposits' && body.currentBalance === undefined && body.principal !== undefined) {
        body.currentBalance = body.principal
      }
      try {
        if (record) {
          await api.patch(`/api/${endpoint}/${record.id}`, body)
          toast('Сохранено', 'success')
        } else {
          await api.post(`/api/${endpoint}`, body)
          toast('Добавлено', 'success')
        }
        render(root)
      } catch (e) {
        throw e
      }
    }
  })
}

function isEditStr(record, cfg) {
  if (!record) return cfg.addTitle || 'Добавить запись'
  // Убираем слово "Новый" из addTitle, получаем "Редактировать ..."
  const title = cfg.addTitle || 'Запись'
  return title.replace(/^Нов(ый|ая|ое)\s+/i, 'Редактировать ')
}

function getCliHint(endpoint) {
  const hints = {
    deposits: 'fin agent add-deposit --bank sber --name "Накопительный" --principal 500000 --rate 8 --opened 2026-03-01',
    holdings: 'fin agent add-holding --broker tinkoff --ticker SBER --quantity 100 --avg-price 250 [--current-price 260]',
    loans: 'fin agent add-loan --bank alfa --name "Потреб" --principal 800000 --remaining 750000 --rate 12 --monthly 15000 --payment-day 15 --opened 2025-06-01 --type consumer',
    subscriptions: 'fin agent add-subscription --name "Яндекс Плюс" --amount 299 --period monthly --next 2026-10-01',
    obligations: 'fin agent add-obligation --name "Аренда" --amount 30000 --period monthly --next 2026-10-05'
  }
  return hints[endpoint] || ''
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
