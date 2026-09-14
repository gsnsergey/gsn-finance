import { api, rub, toast } from '../api.js'
import { openModal } from '../ui/modal.js'
import { BANKS, bankLabel } from '../data/banks.js'
import { CURRENCIES, currencyLabel } from '../data/currencies.js'
import { ACCOUNT_TYPES, accountTypeLabel } from '../data/accountTypes.js'

export async function render(root) {
  const accounts = await api.get('/api/accounts')
  const active = accounts.filter(a => !a.archived)
  const archived = accounts.filter(a => a.archived)

  if (active.length === 0) {
    root.innerHTML = `
      <div class="empty">
        <div class="empty-title">Счетов пока нет</div>
        <div style="margin-top:16px"><button class="btn btn-primary" id="add-acc">+ Добавить счёт</button></div>
      </div>`
    document.getElementById('add-acc').addEventListener('click', () => openAccountForm(root, null))
    return
  }

  root.innerHTML = `
    <div class="page-actions">
      <button class="btn btn-primary" id="add-acc">+ Добавить счёт</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Название</th><th>Банк</th><th>Тип</th><th>Валюта</th><th class="num">Баланс</th><th style="width:90px"></th></tr></thead>
      <tbody>
        ${active.map(a => `
          <tr>
            <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${a.color || '#999'};margin-right:8px;vertical-align:middle"></span>${a.name}</td>
            <td>${bankLabel(a.bank)}</td>
            <td>${accountTypeLabel(a.type)}</td>
            <td>${currencyLabel(a.currency)}</td>
            <td class="num">${rub(a.balance)}</td>
            <td>
              <button class="btn btn-sm" data-action="edit" data-id="${a.id}" title="Редактировать">✎</button>
              <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}" title="Удалить">×</button>
            </td>
          </tr>
        `).join('')}
        <tr style="font-weight:600;background:rgba(0,0,0,0.02)">
          <td colspan="4">Итого</td>
          <td class="num">${rub(active.reduce((s, a) => s + a.balance, 0))}</td>
          <td></td>
        </tr>
      </tbody>
    </table></div>
    ${archived.length > 0 ? `<div class="section-title">Архив (${archived.length})</div>
      <div class="table-wrap"><table class="table">
        ${archived.map(a => `<tr><td>${a.name}</td><td>${bankLabel(a.bank)}</td><td class="num">${rub(a.balance)}</td><td></td></tr>`).join('')}
      </table></div>` : ''}
  `

  document.getElementById('add-acc').addEventListener('click', () => openAccountForm(root, null))

  root.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const account = active.find(a => a.id === btn.dataset.id)
      if (account) openAccountForm(root, account)
    })
  })

  root.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const account = active.find(a => a.id === btn.dataset.id)
      if (!confirm(`Удалить счёт «${account?.name || ''}»? Связанные операции тоже удалятся.`)) return
      try {
        await api.del(`/api/accounts/${btn.dataset.id}`)
        toast('Счёт удалён', 'success')
        render(root)
      } catch (e) { toast(e.message, 'error') }
    })
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
        name: 'type', label: 'Тип', type: 'select', required: true, value: account?.type,
        options: ACCOUNT_TYPES
      },
      { name: 'bank', label: 'Банк', type: 'combobox', placeholder: 'начни вводить или выберите', options: BANKS, value: account?.bank },
      { name: 'balance', label: isEdit ? 'Текущий баланс (₽)' : 'Начальный баланс (₽)', type: 'number', placeholder: '0', step: '0.01', value: account?.balance != null ? account.balance / 100 : 0, kopecks: true },
      { name: 'currency', label: 'Валюта', type: 'combobox', placeholder: 'RUB', options: CURRENCIES, value: account?.currency || 'RUB' },
      { name: 'color', label: 'Цвет', type: 'color', value: account?.color }
    ],
    onSubmit: async (data) => {
      if (data.balance === null || data.balance === 0) {
        data.balance = 0
      } else {
        data.balance = Math.round(Number(data.balance) * 100)
      }
      try {
        if (isEdit) {
          await api.patch(`/api/accounts/${account.id}`, data)
          toast('Счёт обновлён', 'success')
        } else {
          await api.post('/api/accounts', data)
          toast('Счёт создан', 'success')
        }
        render(root)
      } catch (e) {
        throw e
      }
    }
  })
}
