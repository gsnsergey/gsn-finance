// Generic list view для deposits / holdings / loans / subscriptions / obligations.

import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'
import { BANK_VALUES } from '../data/banks.js'

const COL_DATE = () => ({ render: v => v })

const CONFIGS = {
  deposits: {
    title: 'Вклады',
    addTitle: 'Новый вклад',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'bank', label: 'Банк' },
      { key: 'rate', label: 'Ставка, %', render: v => `${v}%` },
      { key: 'openedAt', label: 'Открыт', ...COL_DATE() },
      { key: 'capitalization', label: 'Капитализация', render: v => v ? 'да' : 'нет' },
      { key: 'currentBalance', label: 'Текущий баланс', render: rub, num: true }
    ],
    sumKey: 'currentBalance',
    addFields: () => [
      { name: 'bank', label: 'Банк', type: 'text', required: true, placeholder: 'начни вводить или выбери из списка', suggestions: BANK_VALUES },
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
      { key: 'broker', label: 'Брокер' },
      { key: 'ticker', label: 'Тикер' },
      { key: 'name', label: 'Название' },
      { key: 'quantity', label: 'Кол-во', num: true },
      { key: 'avgPrice', label: 'Ср. цена', num: true },
      { key: 'currency', label: 'Валюта' }
    ],
    addFieldsAsync: async () => {
      const accounts = await api.get('/api/accounts')
      return [
        { name: 'broker', label: 'Брокер', type: 'text', required: true, placeholder: 'tinkoff' },
        { name: 'ticker', label: 'Тикер', type: 'text', required: true, placeholder: 'SBER' },
        { name: 'name', label: 'Название (опционально)', type: 'text', placeholder: 'Сбербанк' },
        { name: 'quantity', label: 'Количество', type: 'number', required: true, step: '0.0001' },
        { name: 'avgPrice', label: 'Средняя цена', type: 'number', required: true, step: '0.01' },
        { name: 'currency', label: 'Валюта', type: 'text', value: 'RUB' },
        {
          name: 'accountId', label: 'Счёт (опционально)', type: 'select',
          options: [{ value: '', label: '— не привязан —' }, ...accounts.map(a => ({ value: a.id, label: a.name }))]
        }
      ]
    }
  },

  loans: {
    title: 'Кредиты',
    addTitle: 'Новый кредит',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'bank', label: 'Банк' },
      { key: 'type', label: 'Тип' },
      { key: 'rate', label: 'Ставка, %', render: v => `${v}%` },
      { key: 'monthlyPayment', label: 'Платёж/мес', render: rub, num: true },
      { key: 'paymentDay', label: 'День' },
      { key: 'remainingAmount', label: 'Остаток', render: rub, num: true }
    ],
    sumKey: 'remainingAmount',
    addFields: () => [
      { name: 'bank', label: 'Банк', type: 'text', required: true, placeholder: 'начни вводить или выбери из списка', suggestions: BANK_VALUES },
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Потреб' },
      {
        name: 'type', label: 'Тип', type: 'select', required: true,
        options: [
          { value: 'consumer', label: 'Потребительский' },
          { value: 'mortgage', label: 'Ипотека' },
          { value: 'credit_line', label: 'Кредитная линия' }
        ]
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
      { key: 'period', label: 'Период' },
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
          options: [
            { value: 'monthly', label: 'Ежемесячно' },
            { value: 'yearly', label: 'Ежегодно' },
            { value: 'weekly', label: 'Еженедельно' }
          ]
        },
        { name: 'nextChargeDate', label: 'Следующий платёж', type: 'date', required: true, value: todayIso() },
        {
          name: 'categoryId', label: 'Категория (опционально)', type: 'select',
          options: [{ value: '', label: '— нет —' }, ...cats.map(c => ({ value: c.id, label: `${c.icon || ''} ${c.name}`.trim() }))]
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
      { key: 'period', label: 'Период' },
      { key: 'nextDueDate', label: 'Следующий', ...COL_DATE() }
    ],
    addFields: () => [
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Аренда' },
      { name: 'recipient', label: 'Получатель', type: 'text', placeholder: 'Иванов' },
      { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, step: '0.01', kopecks: true },
      {
        name: 'period', label: 'Период', type: 'select', required: true,
        options: [
          { value: 'monthly', label: 'Ежемесячно' },
          { value: 'quarterly', label: 'Ежеквартально' },
          { value: 'yearly', label: 'Ежегодно' }
        ]
      },
      { name: 'nextDueDate', label: 'Следующий срок', type: 'date', required: true, value: todayIso() },
      { name: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'За что' }
    ]
  }
}

export function makeListView(endpoint) {
  return async function render(root) {
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
      wireAddButton(root, cfg, endpoint)
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
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                ${cfg.columns.map(c => {
                  const v = r[c.key]
                  const rendered = c.render ? c.render(v) : (v ?? '')
                  return `<td class="${c.num ? 'num' : ''}">${rendered}</td>`
                }).join('')}
                <td><button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">×</button></td>
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

    wireAddButton(root, cfg, endpoint)

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
}

function wireAddButton(root, cfg, endpoint) {
  const btn = document.getElementById('add-btn')
  if (!btn) return
  btn.addEventListener('click', async () => {
    let fields
    try {
      fields = cfg.addFieldsAsync ? await cfg.addFieldsAsync() : cfg.addFields()
    } catch (e) {
      toast('Не удалось подготовить форму: ' + e.message, 'error')
      return
    }
    openModal({
      title: cfg.addTitle || 'Добавить запись',
      fields,
      onSubmit: async (data) => {
        // очистка пустых полей
        const body = {}
        for (const [k, v] of Object.entries(data)) {
          if (v === '' || v === null) continue
          // конвертация рублей в копейки для помеченных полей
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
        await api.post(`/api/${endpoint}`, body)
        toast('Добавлено', 'success')
        render(root)
      }
    })
  })
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
