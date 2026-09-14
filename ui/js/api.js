const BASE = '' // same origin

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
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

export function rub(kop) {
  if (kop === null || kop === undefined || isNaN(kop)) return '—'
  const n = Number(kop) / 100
  const sign = n < 0 ? '-' : ''
  return sign + Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
}

export function toast(msg, kind = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast show ${kind}`
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { el.className = 'toast' }, 2400)
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
