// Generic list view для deposits / holdings / loans / subscriptions / obligations.

import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'
import { BANKS, bankLabel } from '../data/banks.js'
import { CURRENCIES, currencyLabel } from '../data/currencies.js'
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
      { key: 'avgPrice', label: 'Ср. цена', num: true },
      { key: 'currency', label: 'Валюта', render: currencyLabel }
    ],
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
        // В портфеле количество и цена хранятся с точностью до 4 знаков — это
        // стандартный шаг цены/лота у большинства брокеров (дробные акции, ETF).
        { name: 'quantity', label: 'Количество', type: 'number', required: true, step: '0.0001' },
        { name: 'avgPrice', label: 'Средняя цена', type: 'number', required: true, step: '0.0001' },
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

    const total = cfg.sumKey ? rows.reduce((s, r) => s + (r[cfg.sumKey] || 0), 0) : null
    const hasAdd = !!(cfg.addFields || cfg.addFieldsAsync)

    root.innerHTML = `
      ${hasAdd ? `<div class="page-actions"><button class="btn btn-primary" id="add-btn">+ Добавить</button></div>` : ''}
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            ${cfg.columns.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}
            <th style="width:80px"></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                ${cfg.columns.map(c => {
                  const v = r[c.key]
                  const rendered = c.render ? c.render(v) : (v ?? '')
                  return `<td class="${c.num ? 'num' : ''}">${rendered}</td>`
                }).join('')}
                <td>
                  <button class="btn btn-sm" data-action="edit" data-id="${r.id}" title="Редактировать">✎</button>
                  <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}" title="Удалить">×</button>
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
      </div>
    `

    wireFormButton(root, cfg, endpoint, null, render)

    root.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
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
    holdings: 'fin agent add-holding --broker tinkoff --ticker SBER --quantity 100 --avg-price 250',
    loans: 'fin agent add-loan --bank alfa --name "Потреб" --principal 800000 --remaining 750000 --rate 12 --monthly 15000 --payment-day 15 --opened 2025-06-01 --type consumer',
    subscriptions: 'fin agent add-subscription --name "Яндекс Плюс" --amount 299 --period monthly --next 2026-10-01',
    obligations: 'fin agent add-obligation --name "Аренда" --amount 30000 --period monthly --next 2026-10-05'
  }
  return hints[endpoint] || ''
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
