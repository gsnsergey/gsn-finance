const BASE = process.env.FINANS_API || 'http://localhost:3737'

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
    const msg = data && data.error ? `${data.error}${data.field ? ':' + data.field : ''}${data.message ? ' — ' + data.message : ''}` : `HTTP ${res.status}`
    throw new Error(msg)
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
