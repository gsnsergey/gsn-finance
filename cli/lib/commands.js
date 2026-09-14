import { api, listAccounts, listCategories, resolveAccount, resolveCategory } from './api.js'
import { rubToKop, kopToRub, todayIso, nowIso, requireFlag, ok } from './format.js'

export const commands = {}

// ===== ACCOUNTS =====

// Реальный остаток: balance — снимок на дату сверки, currentBalance — с учётом
// операций после неё (считает бэкенд).
function realBalance(a) {
  return a.currentBalance !== undefined && a.currentBalance !== null ? a.currentBalance : a.balance
}

commands['list-accounts'] = async () => {
  const rows = await listAccounts()
  if (rows.length === 0) { console.log('No accounts yet.'); return }
  console.log('Accounts:')
  for (const a of rows) {
    const note = a.balanceAsOf ? `сверен ${a.balanceAsOf}` : 'без сверки'
    console.log(`  ${a.name.padEnd(28)} ${(a.bank || '-').padEnd(10)} ${kopToRub(realBalance(a))}  (${note})`)
  }
}

commands['add-account'] = async (f) => {
  const body = {
    name: requireFlag(f, 'name'),
    type: requireFlag(f, 'type'),
    bank: f.bank,
    currency: f.currency || 'RUB',
    balance: f.balance !== undefined ? rubToKop(f.balance) : 0,
    color: f.color
  }
  const created = await api.post('/api/accounts', body)
  ok(`account "${created.name}" created (${kopToRub(realBalance(created))})`)
}

// Сверка: сообщаем фактический (банковский) остаток на дату — он фиксируется,
// операции после этой даты считаются сверх него.
commands['reconcile-account'] = async (f) => {
  const account = await resolveAccount(requireFlag(f, 'account'))
  const body = { actualBalance: rubToKop(requireFlag(f, 'balance')) }
  if (f['as-of'] !== undefined) body.asOf = f['as-of']

  const res = await api.post(`/api/accounts/${account.id}/reconcile`, body)
  ok(`счёт «${account.name}» сверен на ${res.after.balanceAsOf}: ${kopToRub(res.after.currentBalance)}`)
  console.log(`  зафиксированный остаток: ${kopToRub(res.before.balance)} → ${kopToRub(res.after.balance)}`)
  console.log(`  расхождение до сверки:   ${res.delta === 0 ? 'нет' : kopToRub(res.delta)}`)
}

// Правка счёта: --balance = новая сверка на сегодня,
// --as-of = сдвиг даты фиксации (реальный остаток сохраняется), --clear-as-of = снять фиксацию.
commands['update-account'] = async (f) => {
  const account = await resolveAccount(requireFlag(f, 'account'))
  const body = {}
  if (f.balance !== undefined) body.balance = rubToKop(f.balance)
  if (f.bool['clear-as-of']) body.balanceAsOf = null
  else if (f['as-of'] !== undefined) body.balanceAsOf = f['as-of']

  if (Object.keys(body).length === 0) {
    throw new Error('нужен хотя бы один флаг: --balance, --as-of или --clear-as-of')
  }

  const updated = await api.patch(`/api/accounts/${account.id}`, body)
  const note = updated.balanceAsOf ? `сверен ${updated.balanceAsOf}` : 'без сверки'
  ok(`счёт «${updated.name}»: остаток на дату сверки ${kopToRub(updated.balance)} (${note}), реальный ${kopToRub(realBalance(updated))}`)
}

// ===== TRANSACTIONS =====

commands['list-transactions'] = async (f) => {
  const params = new URLSearchParams()
  if (f.month) {
    const [y, m] = f.month.split('-')
    params.set('from', `${y}-${m}-01`)
    const lastDay = new Date(Number(y), Number(m), 0).getDate()
    params.set('to', `${y}-${m}-${String(lastDay).padStart(2, '0')}`)
  }
  if (f.account) {
    const acc = await resolveAccount(f.account)
    params.set('accountId', acc.id)
  }
  if (f.type) params.set('type', f.type)
  const rows = await api.get(`/api/transactions?${params}`)
  if (rows.length === 0) { console.log('No transactions.'); return }
  console.log('Transactions:')
  for (const t of rows) {
    const sign = t.type === 'expense' ? '-' : '+'
    console.log(`  ${t.date}  ${sign}${kopToRub(t.amount).padEnd(14)} ${t.type.padEnd(8)} ${t.comment || ''}`)
  }
}

commands['add-transaction'] = async (f) => {
  const account = await resolveAccount(requireFlag(f, 'account'))
  const body = {
    accountId: account.id,
    type: requireFlag(f, 'type'),
    amount: rubToKop(requireFlag(f, 'amount')),
    date: f.date || todayIso(),
    comment: f.comment,
    source: f.source || 'agent'
  }
  if (f.category) {
    const cat = await resolveCategory(f.category, body.type === 'income' ? 'income' : 'expense')
    body.categoryId = cat.id
  }
  const created = await api.post('/api/transactions', body)
  ok(`tx ${created.date} ${created.type} ${kopToRub(created.amount)} → ${account.name}`)
}

// ===== DEPOSITS =====

commands['add-deposit'] = async (f) => {
  const body = {
    bank: requireFlag(f, 'bank'),
    name: requireFlag(f, 'name'),
    principal: rubToKop(requireFlag(f, 'principal')),
    rate: Number(requireFlag(f, 'rate')),
    openedAt: requireFlag(f, 'opened'),
    currentBalance: rubToKop(f.current || f.principal),
    capitalization: !!f.bool.capitalization,
    payoutFrequency: f.payout || 'end',
    closedAt: f.closed || null
  }
  const created = await api.post('/api/deposits', body)
  ok(`deposit "${created.name}" @ ${created.bank} ${kopToRub(created.currentBalance)} ${created.rate}%`)
}

// ===== HOLDINGS =====

commands['add-holding'] = async (f) => {
  const avgBuyPrice = Number(requireFlag(f, 'avg-price'))
  // --current-price (опционально): если не указан, считаем равным цене покупки.
  const currentPrice = f['current-price'] !== undefined ? Number(f['current-price']) : avgBuyPrice
  const body = {
    broker: requireFlag(f, 'broker'),
    ticker: requireFlag(f, 'ticker').toUpperCase(),
    name: f.name,
    quantity: Number(requireFlag(f, 'quantity')),
    avgBuyPrice,
    currentPrice,
    currency: f.currency || 'RUB'
  }
  const created = await api.post('/api/holdings', body)
  const sign = created.profit > 0 ? '+' : (created.profit < 0 ? '−' : '')
  ok(`holding ${created.broker}/${created.ticker} qty=${created.quantity} @ avg=${created.avgBuyPrice} now=${created.currentPrice} P/L=${sign}${Math.abs(created.profit).toFixed(2)}`)
}

commands['list-holdings'] = async () => {
  const rows = await api.get('/api/holdings')
  if (rows.length === 0) { console.log('No holdings.'); return }
  for (const h of rows) {
    const sign = h.profit > 0 ? '+' : (h.profit < 0 ? '−' : '')
    console.log(`  ${h.broker.padEnd(12)} ${h.ticker.padEnd(8)} qty=${String(h.quantity).padEnd(10)} avg=${String(h.avgBuyPrice).padEnd(10)} now=${String(h.currentPrice).padEnd(10)} ${h.currency.padEnd(4)} P/L=${sign}${Math.abs(h.profit).toFixed(2)}`)
  }
}

// ===== LOANS =====

commands['add-loan'] = async (f) => {
  const body = {
    bank: requireFlag(f, 'bank'),
    name: requireFlag(f, 'name'),
    principal: rubToKop(requireFlag(f, 'principal')),
    remainingAmount: rubToKop(f.remaining || f.principal),
    rate: Number(requireFlag(f, 'rate')),
    monthlyPayment: rubToKop(requireFlag(f, 'monthly')),
    paymentDay: Number(requireFlag(f, 'payment-day')),
    openedAt: requireFlag(f, 'opened'),
    closedAt: f.closed || null,
    type: requireFlag(f, 'type')
  }
  const created = await api.post('/api/loans', body)
  ok(`loan "${created.name}" @ ${created.bank} remaining=${kopToRub(created.remainingAmount)} ${created.rate}%`)
}

// ===== SUBSCRIPTIONS =====

commands['add-subscription'] = async (f) => {
  const body = {
    name: requireFlag(f, 'name'),
    amount: rubToKop(requireFlag(f, 'amount')),
    period: requireFlag(f, 'period'),
    nextChargeDate: requireFlag(f, 'next'),
    currency: f.currency || 'RUB',
    active: f.bool.active === false ? false : true
  }
  const created = await api.post('/api/subscriptions', body)
  ok(`subscription "${created.name}" ${kopToRub(created.amount)}/${created.period}`)
}

commands['list-subscriptions'] = async () => {
  const rows = await api.get('/api/subscriptions')
  const active = rows.filter(r => r.active)
  if (active.length === 0) { console.log('No active subscriptions.'); return }
  for (const s of active) {
    console.log(`  ${s.name.padEnd(28)} ${kopToRub(s.amount).padEnd(14)} /${s.period.padEnd(8)} next: ${s.nextChargeDate}`)
  }
}

// ===== OBLIGATIONS =====

commands['add-obligation'] = async (f) => {
  const body = {
    name: requireFlag(f, 'name'),
    amount: rubToKop(requireFlag(f, 'amount')),
    period: requireFlag(f, 'period'),
    nextDueDate: requireFlag(f, 'next'),
    currency: f.currency || 'RUB',
    recipient: f.recipient,
    comment: f.comment
  }
  const created = await api.post('/api/obligations', body)
  ok(`obligation "${created.name}" ${kopToRub(created.amount)}/${created.period}`)
}

// ===== REPORTS =====

commands['net-worth'] = async () => {
  const nw = await api.get('/api/summary/net-worth')
  console.log('\nNet worth summary:')
  console.log(`  Assets:`)
  console.log(`    Accounts:    ${kopToRub(nw.accountsTotal)}`)
  console.log(`    Deposits:    ${kopToRub(nw.depositsTotal)}`)
  console.log(`    Total:       ${kopToRub(nw.assets)}`)
  console.log(`  Liabilities:`)
  console.log(`    Loans:       ${kopToRub(nw.loansRemaining)}`)
  console.log(`    Total:       ${kopToRub(nw.liabilities)}`)
  console.log(`  ─────────────────────────────`)
  const sign = nw.netWorth < 0 ? '-' : '+'
  console.log(`  Net worth:    ${sign}${kopToRub(Math.abs(nw.netWorth))}`)
  console.log(`\n  Monthly recurring:`)
  console.log(`    Subscriptions: ${kopToRub(nw.subsMonthly)}`)
  console.log(`    Obligations:   ${kopToRub(nw.obligationsMonthly)}`)
  console.log('')
}

commands['list-categories'] = async () => {
  const rows = await listCategories()
  const exp = rows.filter(r => r.type === 'expense')
  const inc = rows.filter(r => r.type === 'income')
  console.log('Expense categories:')
  for (const c of exp) console.log(`  ${c.icon || '·'} ${c.name}`)
  console.log('Income categories:')
  for (const c of inc) console.log(`  ${c.icon || '·'} ${c.name}`)
}

// ===== T-INVEST IMPORT =====

// Подкоманда t-invest pull [--dry-run]
// Внутри команды разбираем подкоманду через argv[2] (см. cli/bin/fin.js: main(argv.slice(2))).
commands['t-invest'] = async (f) => {
  // Второй позиционный аргумент (subcommand) пробрасывается через flags._
  const sub = (f._ && f._[0]) || 'pull'
  if (sub !== 'pull') {
    throw new Error(`Unknown t-invest subcommand: "${sub}". Доступно: pull`)
  }

  const dryRun = !!(f.bool && f.bool['dry-run'])
  console.log(`→ Импорт портфеля из Т-Инвестиций${dryRun ? ' (DRY-RUN, без записи)' : ''}...`)

  const result = await api.post('/api/holdings/import/tinkoff', { dryRun })
  const { summary } = result

  console.log('')
  console.log(`Счетов просканировано: ${summary.accountsScanned}`)
  for (const a of summary.accounts) {
    const line = `  • ${a.name} (${a.id})${a.error ? '  ✗ ' + a.error : `  +${a.created} новых, ~${a.updated} обновлено, ${a.skipped} пропущено`}`
    console.log(line)
    if (a.positions && a.positions.length > 0) {
      for (const p of a.positions) {
        const mark = p.action === 'created' ? '+' : (p.action === 'would-create' ? '?' : '~')
        const price = p.price ? ` @ ${p.price}` : ''
        console.log(`      ${mark} ${String(p.ticker).padEnd(10)} qty=${String(p.qty).padEnd(10)}${price}`)
      }
    }
  }
  console.log('')
  console.log(`Итого: +${summary.created} новых, ~${summary.updated} обновлено, ${summary.skipped} пропущено`)
  if (summary.errors && summary.errors.length > 0) {
    console.log(`Ошибки (${summary.errors.length}):`)
    for (const e of summary.errors.slice(0, 10)) console.log(`  ! ${JSON.stringify(e)}`)
    if (summary.errors.length > 10) console.log(`  ... и ещё ${summary.errors.length - 10}`)
  }
  ok(dryRun ? 'DRY-RUN завершён' : 'Импорт завершён')
}

// ===== BCS =====
commands['bcs'] = async (f) => {
  const sub = (f._ && f._[0]) || 'list-accounts'
  if (sub === 'list-accounts') {
    return commands['bcs-list-accounts'](f)
  }
  if (sub === 'pull') {
    return commands['bcs-pull'](f)
  }
  throw new Error(`Unknown bcs subcommand: "${sub}". Доступно: list-accounts, pull`)
}

// Список брокерских счетов БКС.
//
// Аргументы:
//   --refresh-token <token>  refresh_token из БКС Онлайн (Trade API)
//   или через env: BCS_REFRESH_TOKEN
//   или через stdin (если ни того, ни другого нет)
//
// Делает:
//   1) Обменивает refresh_token на access_token через Keycloak
//   2) GET /accounts на BCS API
//   3) Печатает список id + name в формате "id  name"
//
// Использование:
//   fin bcs list-accounts --refresh-token eyJ...
//   BCS_REFRESH_TOKEN=eyJ... fin bcs list-accounts
//   echo "eyJ..." | fin bcs list-accounts
//
// После получения ID — обновите brokerAccountId в Настройки → Интеграции.
commands['bcs-list-accounts'] = async (f) => {
  const { authenticate } = await import('../../backend/src/bcs/index.js')
  let token = f['refresh-token'] || process.env.BCS_REFRESH_TOKEN
  if (!token) {
    // Читаем из stdin (если не TTY)
    if (!process.stdin.isTTY) {
      const chunks = []
      for await (const chunk of process.stdin) chunks.push(chunk)
      token = Buffer.concat(chunks).toString().trim()
    }
  }
  if (!token) {
    throw new Error('Не задан refresh_token. Передайте через --refresh-token, env BCS_REFRESH_TOKEN или stdin.')
  }

  console.log('→ Обмениваю refresh_token на access_token...')
  const { access_token } = await authenticate(token)
  console.log('✓ access_token получен')

  console.log('→ Запрашиваю /accounts у BCS API...')
  const res = await fetch('https://be.broker.ru/trade-api-bff-operations/api/v1/accounts', {
    headers: { 'Authorization': `Bearer ${access_token}` }
  })
  if (!res.ok) {
    throw new Error(`BCS /accounts вернул ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const accounts = await res.json()
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log('БКС не вернул ни одного счёта.')
    return
  }

  console.log('')
  console.log(`Найдено счетов: ${accounts.length}`)
  console.log('')
  for (const a of accounts) {
    console.log(`  ${String(a.id).padEnd(20)} ${a.name || a.type || '(без названия)'}`)
  }
  console.log('')
  console.log('Скопируйте нужный id и впишите его как brokerAccountId в Настройки → Интеграции.')
}

commands['bcs-pull'] = async (f) => {
  const brokerAccountId = requireFlag(f, 'brokerAccountId')
  const dryRun = !!(f.bool && f.bool['dry-run'])
  console.log(`→ Импорт портфеля БКС (${brokerAccountId})${dryRun ? ' (DRY-RUN)' : ''}...`)
  const result = await api.post('/api/holdings/import/bcs', { brokerAccountId, dryRun })
  console.log(`Импортировано позиций: ${result.upserted ?? result.positions ?? 0}`)
  ok(dryRun ? 'DRY-RUN завершён' : 'Импорт завершён')
}
