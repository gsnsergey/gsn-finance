import express from 'express'
import db from '../db.js'
import { createCrudRouter, TABLE_CONFIGS } from './crud.js'
import transactionsRouter from './transactions.js'

const router = express.Router()

// Все generic CRUD — один и тот же паттерн
for (const name of Object.keys(TABLE_CONFIGS)) {
  router.use(`/${name}`, createCrudRouter(name))
}

// transactions — отдельный (фильтры + обновление баланса)
router.use('/transactions', transactionsRouter)

// Сводный эндпоинт для дашборда (используется UI и CLI)
router.get('/summary/net-worth', (req, res) => {
  try {
    const accountsTotal = db.prepare(`SELECT COALESCE(SUM(balance), 0) as s FROM accounts WHERE archived = 0`).get().s
    const depositsTotal = db.prepare(`SELECT COALESCE(SUM(currentBalance), 0) as s FROM deposits WHERE closedAt IS NULL`).get().s
    const loansRemaining = db.prepare(`SELECT COALESCE(SUM(remainingAmount), 0) as s FROM loans`).get().s
    const subsMonthly = db.prepare(`
      SELECT COALESCE(SUM(
        CASE period
          WHEN 'monthly' THEN amount
          WHEN 'yearly' THEN amount / 12
          WHEN 'weekly' THEN amount * 52 / 12
        END
      ), 0) as s FROM subscriptions WHERE active = 1
    `).get().s
    const obligationsMonthly = db.prepare(`
      SELECT COALESCE(SUM(
        CASE period
          WHEN 'monthly' THEN amount
          WHEN 'quarterly' THEN amount / 3
          WHEN 'yearly' THEN amount / 12
        END
      ), 0) as s FROM obligations
    `).get().s

    const assets = (accountsTotal || 0) + (depositsTotal || 0)
    const liabilities = (loansRemaining || 0)
    res.json({
      accountsTotal,
      depositsTotal,
      loansRemaining,
      subsMonthly,
      obligationsMonthly,
      assets,
      liabilities,
      netWorth: assets - liabilities,
      ts: new Date().toISOString()
    })
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

export default router
