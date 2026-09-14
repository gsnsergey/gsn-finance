import { api, rub, toast, todayIso } from '../api.js'
import { openModal } from '../ui/modal.js'
import { categoryIconHTML } from '../data/categoryIcons.js'

export async function render(root) {
  const [tx, accounts, categories] = await Promise.all([
    api.get('/api/transactions?limit=200'),
    api.get('/api/accounts'),
    api.get('/api/categories')
  ])

  const accountName = id => accounts.find(a => a.id === id)?.name || '—'
  const categoryName = id => categories.find(c => c.id === id)?.name || ''

  if (tx.length === 0 && accounts.length === 0) {
    root.innerHTML = `<div class="empty">
      <div class="empty-title">Начните со счёта</div>
      Создайте хотя бы один счёт, чтобы добавлять операции.
      <div style="margin-top:16px"><button class="btn btn-primary" id="add-acc">+ Добавить счёт</button></div>
    </div>`
    document.getElementById('add-acc').addEventListener('click', () => openAccountForm(root, null))
    return
  }

  if (tx.length === 0) {
    root.innerHTML = `
      <div class="page-actions">
        <button class="btn btn-primary" id="add-tx">+ Добавить операцию</button>
      </div>
      <div class="table-wrap"><div class="empty">
        <div class="empty-title">Операций пока нет</div>
        Нажми «+ Добавить операцию» или заполни через CLI:<br>
        <code>fin agent add-transaction --account "Tinkoff Black" --type expense --amount 1500 --category "Продукты" --comment "Магнит"</code>
      </div></div>`
    document.getElementById('add-tx').addEventListener('click', () => openTransactionForm(root, accounts, categories, null))
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
              <td class="num">${rub(t.type === 'expense' ? -t.amount : t.amount)}</td>
              <td>${t.comment || ''}</td>
              <td>
                <button class="btn btn-sm" data-action="edit" data-id="${t.id}" title="Редактировать">✎</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${t.id}" title="Удалить">×</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  document.getElementById('add-tx').addEventListener('click', () => openTransactionForm(root, accounts, categories, null))

  root.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const txItem = tx.find(t => t.id === btn.dataset.id)
      if (txItem) openTransactionForm(root, accounts, categories, txItem)
    })
  })

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

function openTransactionForm(root, accounts, categories, tx) {
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

