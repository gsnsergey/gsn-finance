import express from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

export const TABLE_CONFIGS = {
  accounts: {
    table: 'accounts',
    fields: ['name', 'bank', 'type', 'currency', 'balance', 'balanceAsOf', 'color', 'archived'],
    required: ['name', 'type'],
    enums: { type: ['debit', 'credit', 'card', 'savings'] },
    booleanFields: ['archived'],
    defaultOrder: 'createdAt DESC'
  },
  categories: {
    table: 'categories',
    fields: ['name', 'type', 'color', 'icon', 'archived'],
    required: ['name', 'type'],
    enums: { type: ['expense', 'income'] },
    booleanFields: ['archived'],
    defaultOrder: 'type ASC, name ASC'
  },
  deposits: {
    table: 'deposits',
    fields: ['bank', 'name', 'principal', 'rate', 'openedAt', 'closedAt', 'capitalization', 'payoutFrequency', 'currentBalance'],
    required: ['bank', 'name', 'principal', 'rate', 'openedAt', 'currentBalance'],
    enums: { payoutFrequency: ['monthly', 'quarterly', 'end'] },
    booleanFields: ['capitalization'],
    defaultOrder: 'openedAt DESC'
  },
  holdings: {
    table: 'holdings',
    fields: ['broker', 'type', 'ticker', 'name', 'quantity', 'avgBuyPrice', 'currentPrice', 'totalCost', 'currentValue', 'profit', 'profitPct', 'currency', 'account', 'accountId', 'blocked'],
    required: ['broker', 'ticker', 'quantity', 'avgBuyPrice', 'currentPrice'],
    enums: { type: ['stock', 'etf', 'fund', 'bond_ofz', 'bond_corp', 'eurobond', 'future', 'option', 'metal', 'crypto', 'other'] },
    booleanFields: ['blocked'],
    defaultOrder: 'broker ASC, account ASC, ticker ASC'
  },
  loans: {
    table: 'loans',
    fields: ['bank', 'name', 'principal', 'remainingAmount', 'rate', 'monthlyPayment', 'paymentDay', 'openedAt', 'closedAt', 'type'],
    required: ['bank', 'name', 'principal', 'remainingAmount', 'rate', 'monthlyPayment', 'paymentDay', 'openedAt', 'type'],
    enums: { type: ['consumer', 'mortgage', 'credit_line'] },
    defaultOrder: 'openedAt DESC'
  },
  subscriptions: {
    table: 'subscriptions',
    fields: ['name', 'amount', 'currency', 'period', 'nextChargeDate', 'categoryId', 'autoDetected', 'active'],
    required: ['name', 'amount', 'period', 'nextChargeDate'],
    enums: { period: ['monthly', 'yearly', 'weekly'] },
    booleanFields: ['autoDetected', 'active'],
    defaultOrder: 'nextChargeDate ASC'
  },
  obligations: {
    table: 'obligations',
    fields: ['name', 'amount', 'currency', 'period', 'nextDueDate', 'recipient', 'comment'],
    required: ['name', 'amount', 'period', 'nextDueDate'],
    enums: { period: ['monthly', 'quarterly', 'yearly'] },
    defaultOrder: 'nextDueDate ASC'
  }
}

export function bool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1
  if (v === false || v === 0 || v === '0' || v === 'false' || v === null || v === undefined) return 0
  return v ? 1 : 0
}

export function validateRequired(body, required) {
  for (const f of required) {
    const v = body[f]
    if (v === undefined || v === null || v === '') {
      return f
    }
  }
  return null
}

export function validateEnums(body, enums) {
  for (const [field, allowed] of Object.entries(enums)) {
    if (body[field] !== undefined && body[field] !== null && !allowed.includes(body[field])) {
      return { field, allowed }
    }
  }
  return null
}

export function createCrudRouter(name) {
  const cfg = TABLE_CONFIGS[name]
  if (!cfg) throw new Error(`Unknown table config: ${name}`)
  const { table, fields, required = [], enums = {}, booleanFields = [], defaultOrder } = cfg

  const router = express.Router()

  // LIST
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${defaultOrder}`).all()
      res.json(rows)
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message })
    }
  })

  // READ
  router.get('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
    if (!row) return res.status(404).json({ error: 'not_found' })
    res.json(row)
  })

  // CREATE
  router.post('/', (req, res) => {
    const body = req.body || {}
    const missing = validateRequired(body, required)
    if (missing) return res.status(400).json({ error: 'missing_field', field: missing })
    const invalid = validateEnums(body, enums)
    if (invalid) return res.status(400).json({ error: 'invalid_enum', ...invalid })

    const id = body.id || uuid()
    const now = new Date().toISOString()
    const data = { id }

    for (const f of fields) {
      if (body[f] !== undefined) {
        data[f] = booleanFields.includes(f) ? bool(body[f]) : body[f]
      }
    }
    data.createdAt = body.createdAt || now
    data.updatedAt = now

    const cols = Object.keys(data)
    const placeholders = cols.map(() => '?').join(', ')
    const values = cols.map(c => data[c])

    try {
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values)
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
      res.status(201).json(created)
    } catch (e) {
      res.status(400).json({ error: 'db_error', message: e.message })
    }
  })

  // UPDATE
  router.patch('/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'not_found' })

    const body = req.body || {}
    const invalid = validateEnums(body, enums)
    if (invalid) return res.status(400).json({ error: 'invalid_enum', ...invalid })

    const patch = { updatedAt: new Date().toISOString() }
    for (const f of fields) {
      if (body[f] !== undefined) {
        patch[f] = booleanFields.includes(f) ? bool(body[f]) : body[f]
      }
    }

    const cols = Object.keys(patch)
    if (cols.length === 1) return res.json(existing) // только updatedAt, ничего не меняли

    const setClause = cols.map(c => `${c} = ?`).join(', ')
    const values = cols.map(c => patch[c])
    values.push(req.params.id)

    try {
      db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values)
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
      res.json(updated)
    } catch (e) {
      res.status(400).json({ error: 'db_error', message: e.message })
    }
  })

  // DELETE
  router.delete('/:id', (req, res) => {
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, deleted: req.params.id })
  })

  return router
}
