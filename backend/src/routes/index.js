import express from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { createCrudRouter, TABLE_CONFIGS, bool, validateRequired, validateEnums } from './crud.js'
import accountsRouter from './accounts.js'
import transactionsRouter from './transactions.js'
import tInvestRouter from './tinvest.js'
import brokerCredentialsRouter from './broker_credentials.js'
import bcsRouter from './bcs.js'
import importRouter from './import.js'
import reportsRouter from './reports.js'
import { CURRENT_BALANCE_EXPR, todayIso } from '../balance.js'

const router = express.Router()

// accounts — свой роутер (фиксация остатка + сверка, generic CRUD внутри),
// поэтому исключён из generic-цикла: иначе его маршруты перекроются.
router.use('/accounts', accountsRouter)

// Отчёты: агрегаты доходов/расходов для страницы /reports (фильтры + графики).
router.use('/reports', reportsRouter)

// Все generic CRUD — один и тот же паттерн
for (const name of Object.keys(TABLE_CONFIGS)) {
  if (name === 'accounts') continue
  if (name === 'holdings') {
    // holdings: обогащаем ответ accountLabel через JOIN на broker_credentials,
    // чтобы UI мог показать читаемое имя («Копилка Ракета») вместо голого
    // brokerAccountId (для BCS, где /portfolio возвращает только ID).
    router.use('/holdings', createHoldingsRouter())
  } else if (name === 'import_rules') {
    // Алиас на URL с дефисом: TABLE_CONFIGS ключ — `import_rules` (snake_case),
    // а UI/sidebar ожидает kebab-case `/import-rules`.
    router.use('/import-rules', createCrudRouter(name))
  } else {
    router.use(`/${name}`, createCrudRouter(name))
  }
}

// CRUD для holdings с обогащением ответа списка.
// То же, что createCrudRouter, но список и одиночная выборка добавляют поле
// `accountLabel`, которое резолвится через broker_credentials по (provider, account).
function createHoldingsRouter() {
  const cfg = TABLE_CONFIGS.holdings
  const { table, fields, required = [], enums = {}, booleanFields = [], defaultOrder } = cfg
  const router = express.Router()

  // Кеш по провайдеру: Map<brokerAccountId, label>. broker_credentials маленькая,
  // но всё равно кешируем — чтобы на каждую позицию не дёргать SELECT.
  const labelCache = new Map()
  const labelsForProvider = provider => {
    let m = labelCache.get(provider)
    if (!m) {
      m = new Map(db.prepare(
        'SELECT brokerAccountId, label FROM broker_credentials WHERE provider = ?'
      ).all(provider).map(c => [c.brokerAccountId, c.label]))
      labelCache.set(provider, m)
    }
    return m
  }
  const enrich = row => {
    if (!row) return row
    const label = labelsForProvider(row.broker).get(row.account) || null
    return { ...row, accountLabel: label }
  }

  // LIST
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare(
        `SELECT * FROM ${table} ORDER BY ${defaultOrder}`
      ).all()
      res.json(rows.map(enrich))
    } catch (e) { res.status(500).json({ error: 'db_error', message: e.message }) }
  })

  // READ one
  router.get('/:id', (req, res) => {
    try {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
      if (!row) return res.status(404).json({ error: 'not_found' })
      res.json(enrich(row))
    } catch (e) { res.status(500).json({ error: 'db_error', message: e.message }) }
  })

  // CREATE
  router.post('/', async (req, res) => {
    const body = req.body || {}
    const missing = validateRequired(body, required)
    if (missing) return res.status(400).json({ error: 'missing_field', field: missing })
    const invalid = validateEnums(body, enums)
    if (invalid) return res.status(400).json({ error: 'invalid_enum', ...invalid })
    const id = body.id || uuid()
    const now = new Date().toISOString()
    const data = { id }
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = booleanFields.includes(f) ? bool(body[f]) : body[f]
    }
    data.createdAt = body.createdAt || now
    data.updatedAt = now
    const cols = Object.keys(data)
    try {
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(data))
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
      res.status(201).json(enrich(created))
    } catch (e) { res.status(400).json({ error: 'db_error', message: e.message }) }
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
      if (body[f] !== undefined) patch[f] = booleanFields.includes(f) ? bool(body[f]) : body[f]
    }
    const cols = Object.keys(patch)
    if (cols.length === 1) return res.json(enrich(existing))
    try {
      db.prepare(
        `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
      ).run(...Object.values(patch), req.params.id)
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
      res.json(enrich(updated))
    } catch (e) { res.status(400).json({ error: 'db_error', message: e.message }) }
  })

  // DELETE
  router.delete('/:id', (req, res) => {
    try {
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id)
      if (result.changes === 0) return res.status(404).json({ error: 'not_found' })
      res.json({ ok: true, deleted: req.params.id })
    } catch (e) { res.status(500).json({ error: 'db_error', message: e.message }) }
  })

  return router
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

// Импорт банковских выписок (Альфа): preview без записи + import с дедупом.
// Маршруты: /api/import/alfa/preview и /api/transactions/import.
router.use('/import', importRouter)
router.use('/transactions/import', importRouter)

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
    // Недвижимость/имущество живёт в отдельной таблице `properties`, а не в
    // `accounts` (у имущества нет операций, карт и сверки остатка). В активы
    // входит отдельным слагаемым, поэтому accountsTotal остаётся «деньгами».
    const propertiesTotal = db.prepare(
      `SELECT COALESCE(SUM(value), 0) as s FROM properties WHERE archived = 0`
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

    const assets = (Number(accountsTotal) || 0) + (Number(depositsTotal) || 0) + (Number(holdingsTotal) || 0) + (Number(propertiesTotal) || 0)
    const liabilities = (loansRemaining || 0)
    res.json({
      accountsTotal,
      propertiesTotal,
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
// Переводы между своими счетами не учитываются: и импорт, и ручное создание
// пишут их как type='transfer'. Фильтр по source оставлен защитой от
// легаси-строк, у которых перевод мог лежать парой expense/income.
router.get('/summary/today', (req, res) => {
  try {
    const date = todayIso()
    const rows = db.prepare(
      `SELECT type, COALESCE(SUM(amount), 0) AS s
         FROM transactions
        WHERE date = ? AND type IN ('income', 'expense')
          AND COALESCE(source, '') <> 'transfer'
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
