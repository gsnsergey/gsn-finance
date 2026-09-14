import db from './db.js'

/**
 * Модель «зафиксированного остатка».
 *
 *   accounts.balance      — зафиксированный остаток (копейки) на дату accounts.balanceAsOf
 *   accounts.balanceAsOf  — дата фиксации, ISO YYYY-MM-DD (или NULL — фиксации нет)
 *
 * Реальный (текущий) баланс = balance + Σ знаковых сумм операций счёта,
 * у которых календарный день операции строго позже дня фиксации
 * (день фиксации включён в снимок). При balanceAsOf IS NULL текущий баланс
 * равен balance — прежнее инкрементальное поведение не меняется.
 *
 * Формула живёт здесь в одном месте: JS-вариант (currentBalanceOf) и SQL-выражение
 * для выборки списка счетов (CURRENT_BALANCE_EXPR) обязаны совпадать.
 */

// --- даты -------------------------------------------------------------------

// Локальная дата сервера, YYYY-MM-DD (не UTC — сверка идёт по календарю пользователя).
export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Нормализация произвольной ISO-даты/даты-времени до календарного дня YYYY-MM-DD.
// Возвращает null, если распарсить не удалось.
export function dayOf(v) {
  if (v === null || v === undefined) return null
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function isValidDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return false
  const d = dayOf(v)
  if (!d) return false
  // отсекаем «2026-02-31»: SQLite date() вернёт нормализованный день только для валидной даты
  const row = db.prepare('SELECT date(?) AS d').get(d)
  return row && row.d === d
}

export function isFutureDay(v) {
  const d = dayOf(v)
  return d !== null && d > todayIso()
}

/** Предыдущий календарный день (для подсказки «сдвинь фиксацию раньше операции»). */
export function dayBefore(v) {
  const d = dayOf(v)
  if (!d) return null
  return db.prepare('SELECT date(?, ?) AS d').get(d, '-1 day').d
}

// --- формула ----------------------------------------------------------------

const SIGNED_SQL = `CASE type WHEN 'expense' THEN -amount WHEN 'income' THEN amount ELSE 0 END`

/**
 * SQL-выражение «реальный баланс счёта» для строки таблицы accounts с алиасом `a`.
 * Используется в выборках списка/одного счёта и в /api/summary/net-worth.
 */
export const CURRENT_BALANCE_EXPR = `(
  a.balance + CASE WHEN a.balanceAsOf IS NULL THEN 0 ELSE COALESCE((
    SELECT SUM(CASE t.type WHEN 'expense' THEN -t.amount WHEN 'income' THEN t.amount ELSE 0 END)
      FROM transactions t
     WHERE t.accountId = a.id AND date(t.date) > date(a.balanceAsOf)
  ), 0) END
)`

/** Знаковое влияние операции на баланс: expense → −amount, income → +amount, transfer → 0. */
export function signedDelta(type, amount) {
  if (type === 'expense') return -amount
  if (type === 'income') return amount
  return 0
}

/** Движение по счёту после дня фиксации: { count, sum }. */
export function movementAfter(accountId, asOf) {
  const day = dayOf(asOf)
  if (!day) return { count: 0, sum: 0 }
  const row = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(${SIGNED_SQL}), 0) AS sum
      FROM transactions
     WHERE accountId = ? AND date(date) > date(?)
  `).get(accountId, day)
  return { count: row.count, sum: row.sum }
}

export function isFixed(account) {
  return !!account && account.balanceAsOf != null
}

/** Реальный баланс для уже загруженного объекта счёта. */
export function currentBalanceOf(account) {
  if (!account) return null
  if (!isFixed(account)) return account.balance
  return account.balance + movementAfter(account.id, account.balanceAsOf).sum
}

/**
 * Остаток, который надо записать в balance при сдвиге фиксации на новый день,
 * чтобы реальный баланс не изменился:
 *   balance_new = currentBalance_old − Σ signed(t) с датой строго позже newAsOf
 */
export function balanceForAsOf(account, newAsOf) {
  const current = currentBalanceOf(account)
  const day = dayOf(newAsOf)
  if (!day) return current
  return current - movementAfter(account.id, day).sum
}

/** true, если операция с датой `date` попадает в зафиксированную зону счёта. */
export function isRetroFor(account, date) {
  if (!isFixed(account)) return false
  const d = dayOf(date)
  const asOf = dayOf(account.balanceAsOf)
  if (!d || !asOf) return false
  return d <= asOf
}

/**
 * Самодостаточное тело 409-ответа: что случилось и два способа разрешить.
 * Одинаково отдаётся из POST/PATCH транзакций.
 */
export function retroConflictBody(account, date) {
  const asOf = dayOf(account.balanceAsOf)
  const d = dayOf(date)
  const current = currentBalanceOf(account)
  return {
    error: 'retro_transaction',
    message:
      `Счёт «${account.name}» сверен на ${asOf}, а операция датирована ${d}. ` +
      `Операции внутри зафиксированного периода не принимаются: они либо уже учтены в остатке на дату сверки, либо дата введена неверно. ` +
      `Обновите зафиксированный остаток (сверка), если фактический остаток изменился, ` +
      `либо сдвиньте дату фиксации (balanceAsOf) на дату раньше операции.`,
    accountId: account.id,
    accountName: account.name,
    date: d,
    balanceAsOf: asOf,
    balance: account.balance,
    currentBalance: current,
    hint: {
      options: [
        {
          action: 'reconcile',
          method: 'POST',
          path: `/api/accounts/${account.id}/reconcile`,
          body: { actualBalance: current, asOf: todayIso() },
          // что реально даёт вариант: без этого текст подсказки неотличим от «ничего не делать»
          effect: 'операция уже учтена в зафиксированном остатке — повторно вносить её не нужно'
        },
        {
          action: 'move_balance_as_of',
          method: 'PATCH',
          path: `/api/accounts/${account.id}`,
          // день перед операцией: после сдвига фиксации операция перестаёт быть ретро-
          body: { balanceAsOf: dayBefore(d) },
          effect: 'фиксация сдвинется, операция попадёт в расчёт как новая'
        }
      ]
    }
  }
}
