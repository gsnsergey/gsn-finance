import express from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { isFixed, isRetroFor, retroConflictBody, signedDelta, dayOf, isValidDay } from '../balance.js'

const router = express.Router()

function adjustAccountBalance(accountId, delta) {
  db.prepare('UPDATE accounts SET balance = balance + ?, updatedAt = ? WHERE id = ?')
    .run(delta, new Date().toISOString(), accountId)
}

function loadAccount(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
}

// LIST with filters: accountId, categoryId, type, from, to, q
// q — поиск по комментарию, счёту, категории и сумме (регистронезависимый).
router.get('/', (req, res) => {
  const { accountId, categoryId, type, from, to, q, externalRef, limit = 500 } = req.query
  const where = []
  const params = []
  if (accountId) { where.push('accountId = ?'); params.push(accountId) }
  if (categoryId) { where.push('categoryId = ?'); params.push(categoryId) }
  if (type) { where.push('type = ?'); params.push(type) }
  // Обе ноги перевода делят externalRef — по нему UI находит вторую половину.
  if (externalRef) { where.push('externalRef = ?'); params.push(externalRef) }
  if (from) { where.push('date >= ?'); params.push(from) }
  if (to) { where.push('date <= ?'); params.push(to) }
  if (q) {
    // Поиск «одним полем»: комментарий, счёт, категория и сумма.
    // lower_unicode — JS-функция из db.js: SQLite LOWER/LIKE не сворачивают
    // регистр кириллицы, поэтому опускаем регистр обеих сторон сами.
    const needle = String(q).trim().toLowerCase()
    // Сумма в БД в копейках, а пользователь ищет рублями («1500», «1 500,50»).
    const num = needle.replace(/\s+/g, '').replace(',', '.')
    where.push(`(
      lower_unicode(comment) LIKE ?
      OR lower_unicode((SELECT name FROM accounts WHERE id = transactions.accountId)) LIKE ?
      OR lower_unicode((SELECT name FROM categories WHERE id = transactions.categoryId)) LIKE ?
      OR printf('%.2f', amount / 100.0) LIKE ?
      OR CAST(amount AS TEXT) LIKE ?
    )`)
    params.push(`%${needle}%`, `%${needle}%`, `%${needle}%`, `%${num}%`, `%${num}%`)
  }

  const sql = `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, createdAt DESC LIMIT ?`
  params.push(Number(limit))
  try {
    const rows = db.prepare(sql).all(...params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// READ
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// CREATE
router.post('/', (req, res) => {
  const body = req.body || {}
  const required = ['accountId', 'type', 'amount', 'date']
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return res.status(400).json({ error: 'missing_field', field: f })
    }
  }
  if (!['expense', 'income', 'transfer'].includes(body.type)) {
    return res.status(400).json({ error: 'invalid_enum', field: 'type', allowed: ['expense', 'income', 'transfer'] })
  }
  // Направление — только у transfer; для остальных типов допустим null.
  const direction = body.transferDirection === undefined ? null : body.transferDirection
  if (direction !== null && direction !== 'in' && direction !== 'out') {
    return res.status(400).json({ error: 'invalid_enum', field: 'transferDirection', allowed: ['in', 'out', null] })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount' })
  }

  // Дата нормализуется в календарный день ДО ретро-гейта и записи: гейт (dayOf)
  // и SQL-формула currentBalance (date()) обязаны видеть одно и то же значение,
  // иначе битая дата обходит 409 и молча выпадает из расчёта реального остатка.
  // Дата-время клиента трактуется как день, который он записал (без пересчёта в UTC).
  const day = dayOf(body.date)
  if (!day || !isValidDay(day)) {
    return res.status(400).json({ error: 'invalid_date', field: 'date', message: 'Дата в формате YYYY-MM-DD.' })
  }
  body.date = day

  const account = loadAccount(body.accountId)
  if (!account) return res.status(400).json({ error: 'account_not_found' })

  if (body.categoryId) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(body.categoryId)
    if (!cat) return res.status(400).json({ error: 'category_not_found' })
  }

  // Ретро-операция: дата внутри зафиксированного периода счёта (<= balanceAsOf).
  // Такие операции не принимаются: зафиксированный остаток уже включает этот период,
  // и операция посчиталась бы дважды.
  if (isRetroFor(account, body.date)) {
    return res.status(409).json(retroConflictBody(account, body.date))
  }

  const id = body.id || uuid()
  const now = new Date().toISOString()
  // transfer: знак задаёт transferDirection (источник –, получатель +).
  const delta = signedDelta(body.type, amount, direction)
  // У счёта с фиксацией balance не трогаем: он — снимок на дату balanceAsOf,
  // реальный остаток считается как balance + движения строго после фиксации.
  const adjust = !isFixed(account) && delta !== 0

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO transactions
      (id, accountId, type, amount, currency, categoryId, date, comment, source, externalRef, transferDirection, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        body.accountId,
        body.type,
        amount,
        body.currency || 'RUB',
        body.categoryId || null,
        body.date,
        body.comment || null,
        body.source || 'agent',
        body.externalRef || null,
        direction,
        body.createdAt || now,
        now
      )
    if (adjust) adjustAccountBalance(body.accountId, delta)
  })
  try {
    tx()
    const created = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
    res.status(201).json(created)
  } catch (e) {
    res.status(400).json({ error: 'db_error', message: e.message })
  }
})

// UPDATE
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const body = req.body || {}
  if (body.type !== undefined && !['expense', 'income', 'transfer'].includes(body.type)) {
    return res.status(400).json({ error: 'invalid_enum', field: 'type' })
  }
  if (body.amount !== undefined) {
    const a = Number(body.amount)
    if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: 'invalid_amount' })
    body.amount = a
  }
  if (body.transferDirection !== undefined && body.transferDirection !== null
      && body.transferDirection !== 'in' && body.transferDirection !== 'out') {
    return res.status(400).json({ error: 'invalid_enum', field: 'transferDirection', allowed: ['in', 'out', null] })
  }

  // Та же нормализация даты, что и в POST — но только если date реально передан:
  // правка комментария без date проходит как раньше.
  if (body.date !== undefined) {
    const day = dayOf(body.date)
    if (!day || !isValidDay(day)) {
      return res.status(400).json({ error: 'invalid_date', field: 'date', message: 'Дата в формате YYYY-MM-DD.' })
    }
    body.date = day
  }

  const patch = { updatedAt: new Date().toISOString() }
  const allowed = ['accountId', 'type', 'amount', 'currency', 'categoryId', 'date', 'comment', 'source', 'externalRef', 'transferDirection']
  for (const f of allowed) if (body[f] !== undefined) patch[f] = body[f]

  const effective = { ...existing, ...patch }

  const oldAccount = loadAccount(existing.accountId)
  const sameAccount = effective.accountId === existing.accountId
  const newAccount = sameAccount ? oldAccount : loadAccount(effective.accountId)
  if (!newAccount) return res.status(400).json({ error: 'account_not_found' })

  // 409 только когда правка реально переносит операцию (дата/сумма/тип/счёт).
  // UI при редактировании шлёт объект целиком, поэтому сравниваем значения,
  // а не наличие полей: правка комментария у операции, уже лежащей в
  // зафиксированном периоде, должна проходить.
  const moves = ['accountId', 'type', 'amount', 'date'].some(f => {
    if (body[f] === undefined) return false
    if (f === 'amount') return Number(body[f]) !== Number(existing[f])
    return body[f] !== existing[f]
  })
  if (moves && isRetroFor(newAccount, effective.date)) {
    return res.status(409).json(retroConflictBody(newAccount, effective.date))
  }

  const tx = db.transaction(() => {
    // откатываем старое влияние на баланс — только у счёта без фиксации
    const oldDelta = signedDelta(existing.type, existing.amount, existing.transferDirection)
    if (oldDelta !== 0 && oldAccount && !isFixed(oldAccount)) {
      adjustAccountBalance(existing.accountId, -oldDelta)
    }

    const cols = Object.keys(patch)
    const setClause = cols.map(c => `${c} = ?`).join(', ')
    const values = cols.map(c => patch[c])
    values.push(req.params.id)
    db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ?`).run(...values)

    // применяем новое — тоже только если целевой счёт без фиксации
    const newDelta = signedDelta(effective.type, effective.amount, effective.transferDirection)
    if (newDelta !== 0 && !isFixed(newAccount)) {
      adjustAccountBalance(effective.accountId, newDelta)
    }
  })

  try {
    tx()
    const result = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: 'db_error', message: e.message })
  }
})

// DELETE
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const account = loadAccount(existing.accountId)

  const tx = db.transaction(() => {
    const delta = signedDelta(existing.type, existing.amount, existing.transferDirection)
    if (delta !== 0 && account && !isFixed(account)) {
      adjustAccountBalance(existing.accountId, -delta)
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id)
  })

  try {
    tx()
    res.json({ ok: true, deleted: req.params.id })
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

export default router
