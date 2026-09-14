import { kopToRub, todayIso } from './format.js'

const BASE = process.env.FINANS_API || 'http://localhost:3737'

// Ретро-операция (409) — не «HTTP 409», а ситуация с двумя способами разрешения.
// Показываем оба, в терминах CLI, и API-эквивалент.
function retroMessage(d) {
  const opts = (d.hint && d.hint.options) || []
  const rec = opts.find(o => o.action === 'reconcile')
  const move = opts.find(o => o.action === 'move_balance_as_of')
  const lines = [
    `Ретрооперация не принята: счёт «${d.accountName}» сверен на ${d.balanceAsOf}, а операция датирована ${d.date}.`,
    `  зафиксированный остаток на ${d.balanceAsOf}: ${kopToRub(d.balance)}`,
    `  реальный остаток сейчас:                 ${kopToRub(d.currentBalance)}`,
    'Разрешить можно любым из двух способов:',
    `  1) Сверить счёт заново, если фактический (банковский) остаток изменился:`,
    `       fin agent reconcile-account --account "${d.accountName}" --balance <фактический остаток в ₽> [--as-of ${todayIso()}]`,
    rec ? `       API: ${rec.method} ${rec.path} ${JSON.stringify(rec.body)}` : null,
    `  2) Сдвинуть дату фиксации на день раньше операции (реальный остаток при этом не меняется):`,
    move ? `       fin agent update-account --account "${d.accountName}" --as-of ${move.body.balanceAsOf}` : null,
    move ? `       API: ${move.method} ${move.path} ${JSON.stringify(move.body)}` : null
  ]
  return lines.filter(Boolean).join('\n')
}

function errorMessage(data, status) {
  if (data && data.error === 'retro_transaction') return retroMessage(data)
  if (data && data.error) {
    return `${data.error}${data.field ? ':' + data.field : ''}${data.message ? ' — ' + data.message : ''}`
  }
  return `HTTP ${status}`
}

async function request(method, path, body) {
  const url = `${BASE}${path}`
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    throw new Error(errorMessage(data, res.status))
  }
  return data
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, body) => request('POST', p, body),
  patch: (p, body) => request('PATCH', p, body),
  del: (p) => request('DELETE', p)
}

export async function listAccounts({ includeArchived = false } = {}) {
  const rows = await api.get('/api/accounts')
  return includeArchived ? rows : rows.filter(r => !r.archived)
}

export async function listCategories({ type, includeArchived = false } = {}) {
  const rows = await api.get('/api/categories')
  return rows.filter(r =>
    (includeArchived || !r.archived) &&
    (!type || r.type === type)
  )
}

export async function resolveAccount(query) {
  const rows = await listAccounts({ includeArchived: true })
  const byId = rows.find(r => r.id === query)
  if (byId) return byId
  const exact = rows.find(r => r.name === query)
  if (exact) return exact
  const partial = rows.find(r => r.name.toLowerCase().includes(query.toLowerCase()))
  if (partial) return partial
  throw new Error(`account not found: "${query}"`)
}

export async function resolveCategory(query, type) {
  const rows = await listCategories({ type, includeArchived: true })
  const exact = rows.find(r => r.name === query)
  if (exact) return exact
  const partial = rows.find(r => r.name.toLowerCase().includes(query.toLowerCase()))
  if (partial) return partial
  throw new Error(`category not found: "${query}"`)
}
