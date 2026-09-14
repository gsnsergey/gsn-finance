const BASE = '' // same origin

// DD.MM.YYYY из ISO-даты (для сообщений пользователю).
export function fmtDay(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '—')
}

// Человекочитаемое сообщение об ошибке. Отдельно — 409 retro_transaction:
// это не «HTTP 409», а ситуация с двумя понятными способами разрешения.
function errorMessage(data, status) {
  if (data && data.error === 'retro_transaction') {
    return `Счёт «${data.accountName}» сверен на ${fmtDay(data.balanceAsOf)}, `
      + `а операция датирована ${fmtDay(data.date)} — этот период уже зафиксирован в остатке.\n`
      + `Варианты: 1) сверить счёт заново (кнопка «Сверить» на экране «Счета»), если фактический остаток изменился; `
      + `2) сдвинуть дату сверки раньше даты операции.`
  }
  if (data && data.error) {
    return `${data.error}${data.field ? ':' + data.field : ''}${data.message ? ' — ' + data.message : ''}`
  }
  return `HTTP ${status}`
}

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const err = new Error(errorMessage(data, res.status))
    err.status = res.status
    err.data = data
    throw err
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
  const str = (n < 0 ? '-' : '') +
    Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
  // Отрицательные суммы — красным (CSS-класс .amt-neg). Ноль и положительные — обычным цветом.
  return n < 0 ? `<span class="amt-neg">${str}</span>` : str
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
