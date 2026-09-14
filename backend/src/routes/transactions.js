import express from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = express.Router()

function adjustAccountBalance(accountId, delta) {
  db.prepare('UPDATE accounts SET balance = balance + ?, updatedAt = ? WHERE id = ?')
    .run(delta, new Date().toISOString(), accountId)
}

// LIST with filters: accountId, categoryId, type, from, to, q (comment search)
router.get('/', (req, res) => {
  const { accountId, categoryId, type, from, to, q, limit = 500 } = req.query
  const where = []
  const params = []
  if (accountId) { where.push('accountId = ?'); params.push(accountId) }
  if (categoryId) { where.push('categoryId = ?'); params.push(categoryId) }
  if (type) { where.push('type = ?'); params.push(type) }
  if (from) { where.push('date >= ?'); params.push(from) }
  if (to) { where.push('date <= ?'); params.push(to) }
  if (q) { where.push('comment LIKE ?'); params.push(`%${q}%`) }

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
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount' })
  }

  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(body.accountId)
  if (!account) return res.status(400).json({ error: 'account_not_found' })

  if (body.categoryId) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(body.categoryId)
    if (!cat) return res.status(400).json({ error: 'category_not_found' })
  }

  const id = body.id || uuid()
  const now = new Date().toISOString()

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO transactions
      (id, accountId, type, amount, currency, categoryId, date, comment, source, externalRef, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
        body.createdAt || now,
        now
      )
    // обновляем баланс: expense уменьшает, income увеличивает, transfer — handled separately if needed
    const delta = body.type === 'expense' ? -amount : (body.type === 'income' ? amount : 0)
    if (delta !== 0) adjustAccountBalance(body.accountId, delta)
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

  const patch = { updatedAt: new Date().toISOString() }
  const allowed = ['accountId', 'type', 'amount', 'currency', 'categoryId', 'date', 'comment', 'source', 'externalRef']
  for (const f of allowed) if (body[f] !== undefined) patch[f] = body[f]

  const tx = db.transaction(() => {
    // откатываем старое влияние на баланс
    const oldDelta = existing.type === 'expense' ? -existing.amount : (existing.type === 'income' ? existing.amount : 0)
    if (oldDelta !== 0) adjustAccountBalance(existing.accountId, -oldDelta)

    if (Object.keys(patch).length > 0) {
      const cols = Object.keys(patch)
      const setClause = cols.map(c => `${c} = ?`).join(', ')
      const values = cols.map(c => patch[c])
      values.push(req.params.id)
      db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ?`).run(...values)
    }

    // применяем новое
    const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id)
    const newDelta = updated.type === 'expense' ? -updated.amount : (updated.type === 'income' ? updated.amount : 0)
    if (newDelta !== 0) adjustAccountBalance(updated.accountId, newDelta)
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

  const tx = db.transaction(() => {
    const delta = existing.type === 'expense' ? -existing.amount : (existing.type === 'income' ? existing.amount : 0)
    if (delta !== 0) adjustAccountBalance(existing.accountId, -delta)
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
