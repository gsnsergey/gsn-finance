import { api, rub } from '../api.js'

export async function render(root) {
  const [nw, subs, tx] = await Promise.all([
    api.get('/api/summary/net-worth'),
    api.get('/api/subscriptions'),
    api.get('/api/transactions?limit=5')
  ])

  const subsMonthly = subs.filter(s => s.active).reduce((sum, s) => {
    if (s.period === 'monthly') return sum + s.amount
    if (s.period === 'yearly') return sum + s.amount / 12
    if (s.period === 'weekly') return sum + s.amount * 52 / 12
    return sum
  }, 0)

  const nwClass = nw.netWorth >= 0 ? 'success' : 'danger'

  root.innerHTML = `
    <div class="cards">
      <div class="card ${nwClass}">
        <div class="card-label">Капитал</div>
        <div class="card-value">${rub(nw.netWorth)}</div>
        <div class="card-sub">Активы − обязательства</div>
      </div>
      <div class="card accent">
        <div class="card-label">На картах</div>
        <div class="card-value">${rub(nw.accountsTotal)}</div>
        <div class="card-sub">Все счета</div>
      </div>
      <div class="card">
        <div class="card-label">Вклады</div>
        <div class="card-value">${rub(nw.depositsTotal)}</div>
        <div class="card-sub">Открытые депозиты</div>
      </div>
      <div class="card danger">
        <div class="card-label">Кредиты (остаток)</div>
        <div class="card-value">${rub(nw.loansRemaining)}</div>
        <div class="card-sub">Сколько должны</div>
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Подписки / мес</div>
        <div class="card-value">${rub(subsMonthly)}</div>
        <div class="card-sub">${subs.filter(s => s.active).length} активных</div>
      </div>
    </div>

    <div class="section-title">Последние операции</div>
    ${tx.length === 0
      ? `<div class="table-wrap"><div class="empty"><div class="empty-title">Пока пусто</div>Добавьте первую операцию через CLI: <code>fin agent add-transaction ...</code></div></div>`
      : `<div class="table-wrap"><table class="table">
          <thead><tr><th>Дата</th><th>Тип</th><th class="num">Сумма</th><th>Комментарий</th></tr></thead>
          <tbody>
            ${tx.map(t => `
              <tr>
                <td>${t.date}</td>
                <td><span class="badge badge-${t.type}">${t.type === 'expense' ? 'Расход' : 'Доход'}</span></td>
                <td class="num">${rub(t.type === 'expense' ? -t.amount : t.amount)}</td>
                <td>${t.comment || ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>`
    }
  `
}
