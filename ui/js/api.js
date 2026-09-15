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

// `opts.html` (default true) — оборачивать отрицательные суммы в
// `<span class="amt-neg">…</span>` для CSS-стилизации.
// Поставь `false`, если строка попадёт в `<option>` или другой контекст,
// где браузер игнорирует HTML и показывает теги как обычный текст
// (закрытый `<select>` именно так себя ведёт).
export function rub(kop, opts = {}) {
  if (kop === null || kop === undefined || isNaN(kop)) return '—'
  const html = opts.html !== false
  const n = Number(kop) / 100
  const str = (n < 0 ? '-' : '') +
    Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
  // Отрицательные суммы — красным (CSS-класс .amt-neg). Ноль и положительные — обычным цветом.
  if (n < 0 && html) return `<span class="amt-neg">${str}</span>`
  return str
}

export function toast(msg, kind = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast show ${kind}`
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { el.className = 'toast' }, 2400)
}

// Экранирование пользовательских значений для HTML. Каноническая реализация:
// раньше была скопирована в 7 вьюхах и в modal.js; _template.js прямо
// предписывает вынести её в api.js при повторе в 3+ вьюхах.
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Значение для атрибута: тот же алфавит. Отдельное имя — читаемость на месте
// вызова и единая точка, если правила экранирования когда-нибудь разойдутся.
export function escapeAttr(v) { return escapeHtml(v) }

// Безопасный CSS-цвет из данных (account.color, category.color). Значение
// подставляется в атрибут style, поэтому без валидации это вектор инъекции.
// Пропускаем только hex (#rgb/#rgba/#rrggbb/#rrggbbaa), иначе — fallback.
export function cssColor(v, fallback = 'var(--muted)') {
  const s = String(v ?? '')
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ? s : fallback
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
