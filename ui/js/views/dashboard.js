import { api, rub } from '../api.js'

export async function render(root) {
  const [nw, subs, tx, accounts, today, catsList] = await Promise.all([
    api.get('/api/summary/net-worth'),
    api.get('/api/subscriptions'),
    api.get('/api/transactions?limit=5'),
    api.get('/api/accounts'),
    api.get('/api/summary/today'),
    api.get('/api/categories')
  ])

  // Итог по счетам — по реальному остатку (balance + операции после даты сверки),
  // а не по зафиксированному balance. Фолбэк — accountsTotal из /summary (та же формула).
  const accountsTotal = accounts.length > 0
    ? accounts.filter(a => !a.archived).reduce(
        (sum, a) => sum + (a.currentBalance !== undefined && a.currentBalance !== null ? a.currentBalance : a.balance), 0)
    : nw.accountsTotal

  const subsMonthly = subs.filter(s => s.active).reduce((sum, s) => {
    if (s.period === 'monthly') return sum + s.amount
    if (s.period === 'yearly') return sum + s.amount / 12
    if (s.period === 'weekly') return sum + s.amount * 52 / 12
    return sum
  }, 0)

  const nwClass = nw.netWorth >= 0 ? 'success' : 'danger'

  // Обязательства всего = остаток по кредитам + годовая сумма активных подписок
  // (подписки с периодом monthly/yearly/weekly уже приведены к месячному значению).
  const obligationsTotal = (nw.loansRemaining || 0) + Math.round((subsMonthly || 0) * 12)

  // Карточка — обёрнута в <a href="...">, чтобы клик работал как ссылка:
  // правый клик «Открыть в новой вкладке», Tab/Enter из коробки, focus-ring через :focus-visible.
  // «Капитал» — сводка «Активы − обязательства»; отдельной страницы нет, ведём
  // на /obligations, где видна разбивка обязательств (как рекомендовал автор задачи — вариант (b)).
  // Карточка «На картах» ведёт на /accounts — там есть карты и PAN-маски.
  // «Доход/Расход сегодня» — пробрасывают from/to/type в hash; transactions.js
  // (см. T8) уже принимает эти query-параметры через `#/transactions?from=...&to=...&type=...`.
  const todayQ = `from=${today.date}&to=${today.date}`
  const cardLink = (href, klass, label, value, sub) =>
    `<a class="card card-link ${klass || ''}" href="${href}">
      <div class="card-label">${label}</div>
      <div class="card-value">${value}</div>
      <div class="card-sub">${sub}</div>
    </a>`

  root.innerHTML = `
    <div class="cards">
      ${cardLink('#/obligations', nwClass, 'Капитал', rub(nw.netWorth), 'Активы − обязательства')}
      ${cardLink('#/deposits', '', 'Вклады', rub(nw.depositsTotal), 'Открытые депозиты')}
      ${cardLink('#/portfolio', '', 'Портфель', rub(nw.holdingsTotal), (nw.holdingsTotal || 0) === 0 ? 'Нет позиций' : 'Стоимость (по последнему импорту)')}
      ${cardLink('#/loans', 'danger', 'Кредиты (остаток)', rub(nw.loansRemaining), 'Сколько должны')}
      ${cardLink('#/obligations', 'danger', 'Обязательства всего', rub(obligationsTotal), 'Кредиты + годовая сумма подписок')}
    </div>

    <div class="cards">
      ${cardLink('#/subscriptions', '', 'Подписки / мес', rub(subsMonthly), `${subs.filter(s => s.active).length} активных`)}
      ${cardLink('#/accounts', 'accent', 'На картах', rub(accountsTotal), 'Все счета, с учётом операций')}
      ${cardLink(`#/transactions?${todayQ}&type=income`, 'success', 'Доход сегодня', rub(today.incomeToday), `за ${today.date}`)}
      ${cardLink(`#/transactions?${todayQ}&type=expense`, 'danger', 'Расход сегодня', rub(today.expenseToday), `за ${today.date}`)}
    </div>

    <div class="section-title">Последние операции</div>
    ${tx.length === 0
      ? `<div class="table-wrap"><div class="empty"><div class="empty-title">Пока пусто</div>Добавьте первую операцию через CLI: <code>fin agent add-transaction ...</code></div></div>`
      : `<div class="table-wrap"><table class="table">
          <thead><tr><th>Дата</th><th>Тип</th><th class="num">Сумма</th><th>Комментарий</th></tr></thead>
          <tbody>
            ${tx.map(t => `
              <tr class="tx-row" data-tx-id="${t.id}" tabindex="0" role="button" aria-label="Редактировать операцию">
                <td>${t.date}</td>
                <td><span class="badge badge-${t.type}">${t.type === 'expense' ? 'Расход' : 'Доход'}</span></td>
                <td class="num num-${t.type}">${t.type === 'income' ? '+' : ''}${rub(t.type === 'expense' ? -t.amount : t.amount)}</td>
                <td>${t.comment || ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>`
    }
  `

  // Клик по строке «Последние операции» открывает ту же модалку редактирования,
  // что и в transactions.js. Подгружаем модалку динамически, чтобы не дублировать код.
  const txRows = root.querySelectorAll('.tx-row')
  if (txRows.length > 0) {
    const { openTransactionForm } = await import('./transactions.js')
    txRows.forEach(row => {
      const open = () => {
        const item = tx.find(t => t.id === row.dataset.txId)
        if (item) openTransactionForm(root, accounts, catsList, item)
      }
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
      })
    })
  }
}
