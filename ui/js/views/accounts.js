import { api, rub, toast, todayIso, fmtDay } from '../api.js'
import { openModal } from '../ui/modal.js'
import { BANKS, bankLabel } from '../data/banks.js'
import { CURRENCIES, currencyLabel } from '../data/currencies.js'
import { ACCOUNT_TYPES, accountTypeLabel } from '../data/accountTypes.js'

// balance — зафиксированный остаток на дату сверки, currentBalance — реальный
// (с учётом операций после этой даты). Считает бэкенд, см. backend/src/balance.js.
function balanceOf(a) {
  return a.currentBalance !== undefined && a.currentBalance !== null ? a.currentBalance : a.balance
}

function syncLabel(a) {
  return a.balanceAsOf ? `сверен ${fmtDay(a.balanceAsOf)}` : 'без сверки'
}

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
      <thead><tr><th>Название</th><th>Банк</th><th>Тип</th><th>Валюта</th><th class="num">Текущий остаток</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${active.map(a => `
          <tr>
            <td>
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${a.color || '#999'};margin-right:8px;vertical-align:middle"></span>${a.name}
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${syncLabel(a)}</div>
            </td>
            <td>${bankLabel(a.bank)}</td>
            <td>${accountTypeLabel(a.type)}</td>
            <td>${currencyLabel(a.currency)}</td>
            <td class="num">${rub(balanceOf(a))}</td>
            <td>
              <button class="btn btn-sm" data-action="reconcile" data-id="${a.id}" title="Сверить остаток"><i class="fa fa-balance-scale"></i></button>
              <button class="btn btn-sm" data-action="edit" data-id="${a.id}" title="Редактировать">✎</button>
              <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}" title="Удалить">×</button>
            </td>
          </tr>
        `).join('')}
        <tr style="font-weight:600;background:rgba(0,0,0,0.02)">
          <td colspan="4">Итого</td>
          <td class="num">${rub(active.reduce((s, a) => s + balanceOf(a), 0))}</td>
          <td></td>
        </tr>
      </tbody>
    </table></div>
    ${archived.length > 0 ? `<div class="section-title">Архив (${archived.length})</div>
      <div class="table-wrap"><table class="table">
        ${archived.map(a => `<tr><td>${a.name}<div style="font-size:11px;color:var(--muted);margin-top:2px">${syncLabel(a)}</div></td><td>${bankLabel(a.bank)}</td><td class="num">${rub(balanceOf(a))}</td><td></td></tr>`).join('')}
      </table></div>` : ''}
  `

  document.getElementById('add-acc').addEventListener('click', () => openAccountForm(root, null))

  root.querySelectorAll('[data-action="reconcile"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const account = accounts.find(a => a.id === btn.dataset.id)
      if (account) openReconcileForm(root, account)
    })
  })

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

// Сверка: вводим фактический (банковский) остаток на дату — он становится
// зафиксированным balance, а операции после даты считаются сверх него.
function openReconcileForm(root, account) {
  openModal({
    title: `Сверка счёта «${account.name}»`,
    submitLabel: 'Сверить',
    fields: [
      {
        name: 'actualBalance',
        label: 'Фактический остаток (₽)',
        type: 'number',
        required: true,
        step: '0.01',
        placeholder: '0',
        value: balanceOf(account) / 100
      },
      { name: 'asOf', label: 'Дата, на которую остаток верен', type: 'date', required: true, value: todayIso() }
    ],
    onSubmit: async (data) => {
      const actualBalance = data.actualBalance === null || data.actualBalance === ''
        ? 0
        : Math.round(Number(data.actualBalance) * 100)
      if (!Number.isFinite(actualBalance)) throw new Error('Фактический остаток указан неверно')

      const res = await api.post(`/api/accounts/${account.id}/reconcile`, {
        actualBalance,
        asOf: data.asOf
      })

      const delta = res.delta || 0
      if (delta === 0) {
        toast(`Сверено: ${rub(res.after.currentBalance)} — расхождений не было`, 'success')
      } else {
        toast(`Сверено: ${rub(res.after.currentBalance)} (расхождение ${rub(delta)})`, 'success')
      }
      render(root)
    }
  })
}

function openAccountForm(root, account) {
  const isEdit = !!account
  // Остаток в форме — зафиксированный на дату сверки. Его правка означает новую
  // сверку на сегодня, поэтому при сохранении отправляем balance только если он изменился.
  const originalBalance = isEdit ? account.balance : null
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
      {
        name: 'balance',
        label: isEdit
          ? `Остаток на дату сверки (₽) — ${account.balanceAsOf ? fmtDay(account.balanceAsOf) : 'без сверки'}`
          : 'Начальный баланс (₽)',
        type: 'number', placeholder: '0', step: '0.01',
        value: account?.balance != null ? account.balance / 100 : 0,
        kopecks: true
      },
      { name: 'currency', label: 'Валюта', type: 'combobox', placeholder: 'RUB', options: CURRENCIES, value: account?.currency || 'RUB' },
      { name: 'color', label: 'Цвет', type: 'color', value: account?.color }
    ],
    onSubmit: async (data) => {
      const newBalance = data.balance === null || data.balance === ''
        ? 0
        : Math.round(Number(data.balance) * 100)
      if (isEdit) {
        const payload = {
          name: data.name, type: data.type, bank: data.bank,
          currency: data.currency, color: data.color
        }
        // Правка зафиксированной суммы = сверка на сегодня; без правки balanceAsOf не трогаем.
        if (newBalance !== originalBalance) payload.balance = newBalance
        await api.patch(`/api/accounts/${account.id}`, payload)
        toast('Счёт обновлён', 'success')
      } else {
        await api.post('/api/accounts', { ...data, balance: newBalance })
        toast('Счёт создан', 'success')
      }
      render(root)
    }
  })
}
