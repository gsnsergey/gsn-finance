import express from 'express'
import db from '../db.js'
import { createCrudRouter, TABLE_CONFIGS } from './crud.js'
import accountsRouter from './accounts.js'
import transactionsRouter from './transactions.js'
import tInvestRouter from './tinvest.js'
import brokerCredentialsRouter from './broker_credentials.js'
import bcsRouter from './bcs.js'
import { CURRENT_BALANCE_EXPR, todayIso } from '../balance.js'

const router = express.Router()

// accounts — свой роутер (фиксация остатка + сверка, generic CRUD внутри),
// поэтому исключён из generic-цикла: иначе его маршруты перекроются.
router.use('/accounts', accountsRouter)

// Все generic CRUD — один и тот же паттерн
for (const name of Object.keys(TABLE_CONFIGS)) {
  if (name === 'accounts') continue
  router.use(`/${name}`, createCrudRouter(name))
}

// transactions — отдельный (фильтры + обновление баланса)
router.use('/transactions', transactionsRouter)

// Импорт портфеля из Т-Инвестиций (разовая команда).
// URL /api/holdings/import/tinkoff — provider-совместимо (broker_credentials.provider='tinkoff'),
// исторически назывался 'tinvest' (от tinkoff-invest-api), переименован в коммите с broker_credentials.
router.use('/holdings/import/tinkoff', tInvestRouter)

// Импорт портфеля из БКС (разовая команда, brokerAccountId в URL/теле)
router.use('/holdings/import/bcs', bcsRouter)

// CRUD API-токенов брокеров (Т-Инвестиции, БКС, ...)
router.use('/broker-credentials', brokerCredentialsRouter)

// Сводный эндпоинт для дашборда (используется UI и CLI)
router.get('/summary/net-worth', (req, res) => {
  try {
    // Все денежные поля в этом эндпоинте отдаются В КОПЕЙКАХ (integer).
    // UI делит на 100 в `rub()` для отображения в рублях.
    //
    // Сумма по счетам — по реальному балансу (balance + движение после даты фиксации),
    // та же формула, что и в /api/accounts (см. backend/src/balance.js).
    const accountsTotal = db.prepare(
      `SELECT COALESCE(SUM(${CURRENT_BALANCE_EXPR}), 0) as s FROM accounts a WHERE a.archived = 0`
    ).get().s
    const depositsTotal = db.prepare(`SELECT COALESCE(SUM(currentBalance), 0) as s FROM deposits WHERE closedAt IS NULL`).get().s
    // Стоимость портфеля = SUM(currentValue). currentValue УЖЕ в копейках
    // (Tinkoff/BCS upsert: Math.round(rubles * 100)). Раньше здесь было
    // Math.round(... * 100) — лишнее умножение, из-за чего holdingsTotal
    // показывался в 100x больше реального (372k ₽ как 34 млн ₽).
    const holdingsTotal = db.prepare(
      `SELECT COALESCE(SUM(currentValue), 0) AS s FROM holdings`
    ).get().s
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

    const assets = (Number(accountsTotal) || 0) + (Number(depositsTotal) || 0) + (Number(holdingsTotal) || 0)
    const liabilities = (loansRemaining || 0)
    res.json({
      accountsTotal,
      depositsTotal,
      holdingsTotal,
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

// Сводка за сегодня: доходы и расходы по локальной дате сервера.
// Источник для карточек «Доход сегодня» / «Расход сегодня» в дашборде.
// transfer не учитывается — это движение между своими счетами.
router.get('/summary/today', (req, res) => {
  try {
    const date = todayIso()
    const rows = db.prepare(
      `SELECT type, COALESCE(SUM(amount), 0) AS s
         FROM transactions
        WHERE date = ? AND type IN ('income', 'expense')
        GROUP BY type`
    ).all(date)
    let incomeToday = 0
    let expenseToday = 0
    for (const r of rows) {
      if (r.type === 'income') incomeToday = r.s
      else if (r.type === 'expense') expenseToday = r.s
    }
    res.json({ incomeToday, expenseToday, date, ts: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

export default router
