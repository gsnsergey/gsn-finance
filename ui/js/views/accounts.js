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
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${syncLabel(a)}${a.cards && a.cards.length > 0 ? ` · <a href="#" data-action="cards-toggle" data-id="${a.id}" class="cards-badge" title="Показать карты">🗂 ${a.cards.length} ${a.cards.length === 1 ? 'карта' : a.cards.length < 5 ? 'карты' : 'карт'}</a>` : ` · <a href="#" data-action="cards-manage" data-id="${a.id}" class="cards-badge" style="color:var(--muted)" title="Привязать карты">+ карты</a>`}</div>
              ${a.cards && a.cards.length > 0 ? `<div class="cards-list" data-cards-for="${a.id}" hidden>
                ${a.cards.map(c => `<div class="cards-list-item">${escapeHtml(c.panMask)}${c.label ? ` <span class="muted">— ${escapeHtml(c.label)}</span>` : ''}</div>`).join('')}
              </div>` : ''}
            </td>
            <td>${bankLabel(a.bank)}</td>
            <td>${accountTypeLabel(a.type)}</td>
            <td>${currencyLabel(a.currency)}</td>
            <td class="num">${rub(balanceOf(a))}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-sm" data-action="cards-manage" data-id="${a.id}" title="Карты"><i class="fa fa-credit-card"></i></button>
                <button class="btn btn-sm" data-action="reconcile" data-id="${a.id}" title="Сверить остаток"><i class="fa fa-balance-scale"></i></button>
                <button class="btn btn-sm" data-action="edit" data-id="${a.id}" title="Редактировать">✎</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}" title="Удалить">×</button>
              </div>
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

  // Раскрыть/свернуть список карт под именем счёта
  root.querySelectorAll('[data-action="cards-toggle"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const list = root.querySelector(`[data-cards-for="${link.dataset.id}"]`)
      if (list) list.hidden = !list.hidden
    })
  })

  // Открыть модалку управления картами
  root.querySelectorAll('[data-action="cards-manage"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const account = accounts.find(a => a.id === link.dataset.id)
      if (account) openCardsForm(root, account)
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

  // Компактная плашка с текущими картами + ссылка-кнопка для перехода
  // в отдельную мини-форму управления. Это вариант (2) из задачи — НЕ
  // встраиваем редактирование карт в основную форму счёта (там декларативный
  // `fields`, добавлять новый тип поля — лишняя сложность).
  const cardsSection = (isEdit && account.cards && account.cards.length > 0)
    ? `<div class="form-field">
        <label>Карты</label>
        <div style="font-size:13px;line-height:1.6;color:var(--muted)">
          ${account.cards.map(c => `<div>${escapeHtml(c.panMask)}${c.label ? ` <span style="color:var(--muted)">— ${escapeHtml(c.label)}</span>` : ''}</div>`).join('')}
          <a href="#" id="manage-cards-link" style="display:inline-block;margin-top:6px">Управлять картами</a>
        </div>
      </div>`
    : (isEdit
        ? `<div class="form-field">
            <label>Карты</label>
            <div style="font-size:13px;color:var(--muted)">
              Не привязаны. <a href="#" id="manage-cards-link">Привязать карту</a>
            </div>
          </div>`
        : '')

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
    onMount: (dialog) => {
      // Если есть HTML-секция карт — добавляем её в форму как не-input блок
      // (после поля «Цвет»). Ссылка «Управлять картами» откроет отдельную модалку.
      if (cardsSection) {
        const wrapper = document.createElement('div')
        wrapper.innerHTML = cardsSection
        dialog.querySelector('.modal-form').appendChild(wrapper.firstElementChild)
        const link = dialog.querySelector('#manage-cards-link')
        if (link) link.addEventListener('click', (e) => {
          e.preventDefault()
          // Закрываем текущую модалку, открываем управление картами.
          // После закрытия карточной модалки пользователь снова увидит счёт
          // с обновлённым списком карт.
          document.querySelector('.modal-backdrop')?.remove()
          openCardsForm(root, account)
        })
      }
    },
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

// Модалка «Карты счёта»: список существующих + форма добавления новой.
// Полный PAN не запрашивается — только маска (6 цифр + ≥4 плюсов + 4 цифры).
function openCardsForm(root, account) {
  // Используем кастомный HTML вместо декларативного openModal, т. к. тут
  // нужны динамический список + форма добавления + inline-удаление.
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'

  const cards = account.cards || []

  function render() {
    backdrop.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-title">Карты счёта «${escapeHtml(account.name)}»</div>
        <div id="cards-list-area">
          ${cards.length === 0
            ? '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">Карты ещё не привязаны.</div>'
            : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
                ${cards.map(c => `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px">
                    <div>
                      <div style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${escapeHtml(c.panMask)}</div>
                      ${c.label ? `<div style="font-size:12px;color:var(--muted)">${escapeHtml(c.label)}</div>` : ''}
                    </div>
                    <button class="btn btn-sm btn-danger" data-card-del="${escapeHtml(c.id)}" title="Удалить">×</button>
                  </div>
                `).join('')}
              </div>`}
          <form id="card-add-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;padding-top:12px;border-top:1px solid var(--border)">
            <div class="form-field" style="flex:1;min-width:160px;margin:0">
              <label>Маска PAN</label>
              <input type="text" name="panMask" placeholder="220015++++++4795" pattern="^\\d{6}\\+{4,}\\d{4}$" required>
            </div>
            <div class="form-field" style="flex:1;min-width:120px;margin:0">
              <label>Метка</label>
              <input type="text" name="label" placeholder="На продукты" maxlength="64">
            </div>
            <button type="submit" class="btn btn-primary">+ Добавить карту</button>
          </form>
          <div id="card-form-error" class="form-error" style="display:none"></div>
          <div style="font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5">
            Хранится только маска (6 цифр + ≥4 плюсов + 4 цифры). Полный PAN не запрашивается и не сохраняется.
          </div>
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn" id="cards-close">Готово</button>
        </div>
      </div>
    `
  }

  render()
  document.body.appendChild(backdrop)

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) { backdrop.remove(); render(root) }
  })
  backdrop.querySelector('#cards-close').addEventListener('click', () => {
    backdrop.remove(); render(root)
  })

  backdrop.querySelectorAll('[data-card-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.cardDel
      if (!confirm('Удалить карту?')) return
      try {
        await api.del(`/api/accounts/${account.id}/cards/${id}`)
        const idx = cards.findIndex(c => c.id === id)
        if (idx >= 0) cards.splice(idx, 1)
        toast('Карта удалена', 'success')
        render()
      } catch (e) { toast(e.message, 'error') }
    })
  })

  backdrop.querySelector('#card-add-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const panMask = form.panMask.value.trim()
    const label = form.label.value.trim() || null
    const errEl = backdrop.querySelector('#card-form-error')
    errEl.style.display = 'none'
    if (!/^\d{6}\+{4,}\d{4}$/.test(panMask)) {
      errEl.textContent = 'Маска должна быть в формате 6 цифр + ≥4 плюсов + 4 цифры (например, 220015++++++4795). Полный PAN не принимается.'
      errEl.style.display = 'block'
      return
    }
    try {
      const created = await api.post(`/api/accounts/${account.id}/cards`, { panMask, label })
      cards.push(created)
      form.reset()
      toast('Карта добавлена', 'success')
      render()
    } catch (e) {
      errEl.textContent = e.message || 'Не удалось добавить карту'
      errEl.style.display = 'block'
    }
  })
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
