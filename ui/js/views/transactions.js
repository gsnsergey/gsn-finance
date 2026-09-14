import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'

export async function render(root) {
  const [tx, accounts, categories] = await Promise.all([
    api.get('/api/transactions?limit=200'),
    api.get('/api/accounts'),
    api.get('/api/categories')
  ])

  const accountName = id => accounts.find(a => a.id === id)?.name || '—'
  const categoryName = id => categories.find(c => c.id === id)?.name || ''

  if (tx.length === 0 && accounts.length === 0) {
    // первичное состояние — нет ни счетов, ни операций
    root.innerHTML = `<div class="empty">
      <div class="empty-title">Начните со счёта</div>
      Создайте хотя бы один счёт, чтобы добавлять операции.
      <div style="margin-top:16px"><button class="btn btn-primary" id="add-acc">+ Добавить счёт</button></div>
    </div>`
    document.getElementById('add-acc').addEventListener('click', () => openAddAccount(root))
    return
  }

  if (tx.length === 0) {
    // есть счета, но нет операций
    root.innerHTML = `
      <div class="page-actions">
        <button class="btn btn-primary" id="add-tx">+ Добавить операцию</button>
      </div>
      <div class="table-wrap"><div class="empty">
        <div class="empty-title">Операций пока нет</div>
        Нажми «+ Добавить операцию» или заполни через CLI:<br>
        <code>fin agent add-transaction --account "Tinkoff Black" --type expense --amount 1500 --category "Продукты" --comment "Магнит"</code>
      </div></div>`
    document.getElementById('add-tx').addEventListener('click', () => openAddTransaction(root, accounts, categories))
    return
  }

  root.innerHTML = `
    <div class="page-actions">
      <button class="btn btn-primary" id="add-tx">+ Добавить операцию</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Счёт</th>
            <th>Категория</th>
            <th>Тип</th>
            <th class="num">Сумма</th>
            <th>Комментарий</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tx.map(t => `
            <tr data-id="${t.id}">
              <td>${t.date}</td>
              <td>${accountName(t.accountId)}</td>
              <td>${categoryName(t.categoryId)}</td>
              <td><span class="badge badge-${t.type}">${t.type}</span></td>
              <td class="num">${rub(t.type === 'expense' ? -t.amount : t.amount)}</td>
              <td>${t.comment || ''}</td>
              <td><button class="btn btn-sm btn-danger" data-action="delete" data-id="${t.id}">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  document.getElementById('add-tx').addEventListener('click', () => openAddTransaction(root, accounts, categories))
  root.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить операцию?')) return
      try {
        await api.del(`/api/transactions/${btn.dataset.id}`)
        toast('Удалено', 'success')
        render(root)
      } catch (e) { toast(e.message, 'error') }
    })
  })
}

function openAddTransaction(root, accounts, categories) {
  if (!accounts || accounts.length === 0) {
    toast('Сначала создайте счёт', 'error')
    return
  }
  openModal({
    title: 'Новая операция',
    fields: [
      {
        name: 'type', label: 'Тип', type: 'select', required: true,
        options: [{ value: 'expense', label: 'Расход' }, { value: 'income', label: 'Доход' }]
      },
      { name: 'amount', label: 'Сумма (₽)', type: 'number', required: true, placeholder: '1500', step: '0.01', kopecks: true },
      {
        name: 'accountId', label: 'Счёт', type: 'select', required: true,
        options: accounts.filter(a => !a.archived).map(a => ({ value: a.id, label: `${a.name} — ${rub(a.balance)}` }))
      },
      {
        name: 'categoryId', label: 'Категория', type: 'select',
        options: [{ value: '', label: '— без категории —' }, ...categories.map(c => ({
          value: c.id, label: `${c.icon || ''} ${c.name}`.trim()
        }))]
      },
      { name: 'date', label: 'Дата', type: 'date', required: true, value: todayIso() },
      { name: 'comment', label: 'Комментарий', type: 'text', placeholder: 'Магнит' }
    ],
    onSubmit: async (data) => {
      const body = { ...data, source: 'manual' }
      if (!body.categoryId) delete body.categoryId
      if (body.amount === null || body.amount <= 0) throw new Error('Сумма должна быть больше нуля')
      body.amount = Math.round(Number(body.amount) * 100)
      await api.post('/api/transactions', body)
      toast('Операция добавлена', 'success')
      render(root)
    }
  })
}

function openAddAccount(root) {
  openModal({
    title: 'Новый счёт',
    fields: [
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Tinkoff Black' },
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
