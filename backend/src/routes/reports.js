import express from 'express'
import db from '../db.js'

const router = express.Router()

const ALLOWED_TYPES = ['income', 'expense']

// Отчёт «доходы/расходы» с фильтрами и агрегатами для графиков.
//
// GET /api/reports/income-expense?from&to&accountId&categoryId&type
//   type: ''/отсутствует — оба; 'income' | 'expense' — сужение. Иное значение —
//   400 invalid_enum, чтобы опечатка в query не отдавала молча «всё подряд».
//
// Все денежные значения — в копейках (integer), как в остальных эндпоинтах.
//
// Переводы между своими счетами исключены ВСЕГДА: это не доход и не расход.
// `type IN ('income','expense')` отсекает текущие transfer-записи, а
// `COALESCE(source,'') <> 'transfer'` — защита от легаси-строк, у которых
// перевод мог лежать парой income/expense (та же защита, что в /api/summary/today).
router.get('/income-expense', (req, res) => {
  try {
    const { from, to, accountId, categoryId, type } = req.query

    let typeFilter = null
    if (type !== undefined && type !== '') {
      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ error: 'invalid_enum', field: 'type' })
      }
      typeFilter = type
    }

    // Единый параметризованный WHERE для всех агрегатов. Значения из запроса
    // попадают только через placeholders — конкатенации нет.
    const buildWhere = (alias) => {
      const where = [
        `${alias}.type IN ('income', 'expense')`,
        `COALESCE(${alias}.source, '') <> 'transfer'`
      ]
      const params = []
      if (typeFilter) { where.push(`${alias}.type = ?`); params.push(typeFilter) }
      if (from) { where.push(`${alias}.date >= ?`); params.push(from) }
      if (to) { where.push(`${alias}.date <= ?`); params.push(to) }
      if (accountId) { where.push(`${alias}.accountId = ?`); params.push(accountId) }
      if (categoryId) { where.push(`${alias}.categoryId = ?`); params.push(categoryId) }
      return { sql: where.join(' AND '), params }
    }

    const t = buildWhere('t')

    // totals: доход, расход, число операций. net считаем в JS — так формула
    // «доход − расход» видна явно и не теряется в SQL.
    const totalsRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
        COUNT(*) AS cnt
      FROM transactions t
      WHERE ${t.sql}
    `).get(...t.params)

    // periods: по месяцам (substr(YYYY-MM-DD,1,7)), по возрастанию.
    // Месяц без одной из сторон даёт 0 через CASE, а не пропуск строки.
    const periods = db.prepare(`
      SELECT
        substr(t.date, 1, 7) AS period,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
      FROM transactions t
      WHERE ${t.sql}
      GROUP BY period
      ORDER BY period ASC
    `).all(...t.params)

    // categories: имя категории либо «Без категории». Тип строки — тип ОПЕРАЦИИ
    // (единственный авторитетный источник для доход/расход), категория даёт
    // только отображение (имя/цвет/иконку). Поэтому категория, использованная
    // и в доходе, и в расходе, даёт две отдельные строки — так доли в
    // totalsByType (ui/js/views/reports.js) и donut сходятся с totals.
    // Сумма положительная, сортировка по убыванию. Группировка по (categoryId, t.type).
    const categories = db.prepare(`
      SELECT
        t.categoryId AS categoryId,
        COALESCE(c.name, 'Без категории') AS name,
        t.type AS type,
        c.color AS color,
        c.icon AS icon,
        SUM(t.amount) AS amount
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.categoryId
      WHERE ${t.sql}
      GROUP BY t.categoryId, t.type
      ORDER BY amount DESC
    `).all(...t.params)

    // accounts: имя счёта либо «—» (счёт мог быть удалён — FK ON DELETE CASCADE
    // обычно не оставляет сирот, но LEFT JOIN защищает агрегат от потери строки).
    const accounts = db.prepare(`
      SELECT
        t.accountId AS accountId,
        COALESCE(a.name, '—') AS name,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.accountId
      WHERE ${t.sql}
      GROUP BY t.accountId
      ORDER BY (income + expense) DESC
    `).all(...t.params)

    const income = Number(totalsRow.income) || 0
    const expense = Number(totalsRow.expense) || 0

    res.json({
      from: from || null,
      to: to || null,
      totals: {
        income,
        expense,
        net: income - expense,
        count: Number(totalsRow.cnt) || 0
      },
      periods,
      categories,
      accounts
    })
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

export default router
