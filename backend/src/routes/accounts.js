import express from 'express'
import db from '../db.js'
import { v4 as uuid } from 'uuid'
import { createCrudRouter, TABLE_CONFIGS, bool, validateEnums } from './crud.js'
import {
  CURRENT_BALANCE_EXPR,
  todayIso,
  dayOf,
  isValidDay,
  isFutureDay,
  isFixed,
  currentBalanceOf,
  movementAfter,
  balanceForAsOf
} from '../balance.js'

/**
 * Счета — не «чистый» CRUD: у них есть зафиксированный остаток
 * (balance + balanceAsOf) и эндпоинт сверки.
 *
 * Generic CRUD переиспользуется как есть (router.use ниже), поверх него:
 *   GET  /:id/reconcile  — превью сверки (без записи)
 *   POST /:id/reconcile  — сверка: balance := фактический остаток, balanceAsOf := дата
 *   PATCH /:id           — правка баланса = фиксация; сдвиг/снятие balanceAsOf
 */

const router = express.Router()

// --- helpers ----------------------------------------------------------------

function loadAccount(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
}

// Карты счёта (маски PAN). Для UI — массив объектов { id, panMask, label }.
function loadCardsForAccount(accountId) {
  return db.prepare(
    'SELECT id, panMask, label FROM account_cards WHERE accountId = ? ORDER BY label, panMask'
  ).all(accountId)
}

function withCards(account) {
  if (!account || !account.id) return account
  return { ...account, cards: loadCardsForAccount(account.id) }
}

/** Снимок состояния остатка: фиксированная часть + движение после фиксации. */
function snapshot(account) {
  const moved = isFixed(account)
    ? movementAfter(account.id, account.balanceAsOf)
    : { count: 0, sum: 0 }
  return {
    balance: account.balance,
    balanceAsOf: account.balanceAsOf ?? null,
    countAfter: moved.count,
    sumAfter: moved.sum,
    currentBalance: account.balance + moved.sum
  }
}

function withCurrentBalance(account) {
  return { ...account, balanceAsOf: account.balanceAsOf ?? null, currentBalance: currentBalanceOf(account) }
}

// Ответы generic CRUD (создание счёта) тоже должны нести currentBalance.
// Если поле уже посчитано в SQL — не пересчитываем.
function decorate(body) {
  if (Array.isArray(body)) return body.map(decorate)
  if (body && typeof body === 'object' && 'id' in body && 'balance' in body && !('currentBalance' in body)) {
    return withCurrentBalance(body)
  }
  return body
}

function badBalanceAsOf(res, message) {
  return res.status(400).json({ error: 'invalid_balance_as_of', field: 'balanceAsOf', message })
}

// --- сверка -----------------------------------------------------------------

// Превью: что изменится, если зафиксировать остаток. Ничего не пишет.
router.get('/:id/reconcile', (req, res) => {
  const account = loadAccount(req.params.id)
  if (!account) return res.status(404).json({ error: 'not_found' })
  res.json(snapshot(account))
})

// Сверка: фиксируем фактический остаток на дату.
router.post('/:id/reconcile', (req, res) => {
  const account = loadAccount(req.params.id)
  if (!account) return res.status(404).json({ error: 'not_found' })

  const body = req.body || {}
  const raw = body.actualBalance !== undefined ? body.actualBalance : body.balance
  if (raw === undefined || raw === null || raw === '') {
    return res.status(400).json({ error: 'missing_field', field: 'actualBalance' })
  }
  const actual = Number(raw)
  if (!Number.isInteger(actual)) {
    return res.status(400).json({
      error: 'invalid_actual_balance',
      field: 'actualBalance',
      message: 'Фактический остаток указывается целым числом копеек (0 и отрицательные допустимы).'
    })
  }

  const rawAsOf = body.asOf
  const asOf = (rawAsOf === undefined || rawAsOf === null || rawAsOf === '') ? todayIso() : String(rawAsOf).trim()
  if (!isValidDay(asOf)) return badBalanceAsOf(res, 'Дата сверки должна быть в формате YYYY-MM-DD.')
  if (isFutureDay(asOf)) return badBalanceAsOf(res, 'Дата сверки не может быть в будущем.')

  const before = snapshot(account)

  try {
    db.prepare('UPDATE accounts SET balance = ?, balanceAsOf = ?, updatedAt = ? WHERE id = ?')
      .run(actual, asOf, new Date().toISOString(), account.id)
  } catch (e) {
    return res.status(400).json({ error: 'db_error', message: e.message })
  }

  const updated = loadAccount(account.id)
  const after = snapshot(updated)
  res.json({
    account: withCurrentBalance(updated),
    before,
    after,
    delta: after.currentBalance - before.currentBalance
  })
})

// --- PATCH счета ------------------------------------------------------------

router.patch('/:id', (req, res) => {
  const existing = loadAccount(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const body = req.body || {}
  const cfg = TABLE_CONFIGS.accounts
  const invalid = validateEnums(body, cfg.enums || {})
  if (invalid) return res.status(400).json({ error: 'invalid_enum', ...invalid })

  const hasBalance = body.balance !== undefined && body.balance !== null && body.balance !== ''
  const hasAsOf = Object.prototype.hasOwnProperty.call(body, 'balanceAsOf')

  let balance = existing.balance
  let balanceAsOf = existing.balanceAsOf ?? null

  if (hasAsOf) {
    const raw = body.balanceAsOf
    if (raw === null || raw === '') {
      // Снятие фиксации: balance становится реальным текущим остатком.
      balanceAsOf = null
      if (!hasBalance) balance = currentBalanceOf(existing)
    } else {
      const day = String(raw).trim()
      if (!isValidDay(day)) return badBalanceAsOf(res, 'Дата фиксации должна быть в формате YYYY-MM-DD.')
      if (isFutureDay(day)) return badBalanceAsOf(res, 'Дата фиксации не может быть в будущем.')
      // Сдвиг фиксации с сохранением реального баланса.
      if (!hasBalance) balance = balanceForAsOf(existing, day)
      balanceAsOf = day
    }
  } else if (hasBalance) {
    // Ручная правка баланса = фиксация на сегодня.
    balanceAsOf = todayIso()
  }

  if (hasBalance) {
    const v = Number(body.balance)
    if (!Number.isFinite(v)) {
      return res.status(400).json({ error: 'invalid_balance', field: 'balance', message: 'Баланс указывается числом копеек.' })
    }
    balance = Math.round(v)
  }

  // accountNumber: 20 цифр (российский р/с) или пусто (null/'' = снять номер).
  // Пустое значение трактуется как NULL — для счетов без чёткого номера
  // (свойства, кредитные карты без привязки к р/с).
  if (body.accountNumber !== undefined) {
    const raw = body.accountNumber
    if (raw === null || raw === '') {
      body.accountNumber = null
    } else {
      const trimmed = String(raw).replace(/\s+/g, '')
      if (!/^\d{20}$/.test(trimmed)) {
        return res.status(400).json({
          error: 'invalid_account_number',
          field: 'accountNumber',
          message: 'Номер счёта должен состоять из 20 цифр (российский формат). Пробелы допускаются и игнорируются.'
        })
      }
      body.accountNumber = trimmed
    }
  }

  const patch = { balance, balanceAsOf, updatedAt: new Date().toISOString() }
  for (const f of cfg.fields) {
    if (f === 'balance' || f === 'balanceAsOf') continue
    if (body[f] !== undefined) {
      patch[f] = (cfg.booleanFields || []).includes(f) ? bool(body[f]) : body[f]
    }
  }

  const cols = Object.keys(patch)
  const setClause = cols.map(c => `${c} = ?`).join(', ')
  const values = cols.map(c => patch[c])
  values.push(existing.id)

  try {
    db.prepare(`UPDATE accounts SET ${setClause} WHERE id = ?`).run(...values)
    res.json(withCurrentBalance(loadAccount(existing.id)))
  } catch (e) {
    res.status(400).json({ error: 'db_error', message: e.message })
  }
})

// --- POST счёта -------------------------------------------------------------

// Создание счёта валидирует balanceAsOf до generic CRUD: невалидная («banana»)
// или будущая дата сделала бы счёт «замороженным» (date(balanceAsOf) IS NULL →
// currentBalance ≡ balance, ретро-защита выключена).
// Пустое значение = фиксации нет (поле снимается, колонка остаётся NULL).
// Валидное значение нормализуется в календарный день и уходит в generic CRUD
// (next() → decorate + createCrudRouter ниже), состав полей не меняется.
router.post('/', (req, res, next) => {
  const body = req.body || {}
  const hasAsOf = Object.prototype.hasOwnProperty.call(body, 'balanceAsOf')
  const raw = body.balanceAsOf

  if (!hasAsOf || raw === null || raw === '') {
    delete body.balanceAsOf
    return next()
  }

  const day = String(raw).trim()
  if (!isValidDay(day)) return badBalanceAsOf(res, 'Дата фиксации должна быть в формате YYYY-MM-DD.')
  if (isFutureDay(day)) return badBalanceAsOf(res, 'Дата фиксации не может быть в будущем.')
  body.balanceAsOf = day

  // accountNumber: тот же контракт, что в PATCH — 20 цифр или пусто.
  if (body.accountNumber !== undefined) {
    const accNum = body.accountNumber
    if (accNum === null || accNum === '') {
      body.accountNumber = null
    } else {
      const trimmed = String(accNum).replace(/\s+/g, '')
      if (!/^\d{20}$/.test(trimmed)) {
        return res.status(400).json({
          error: 'invalid_account_number',
          field: 'accountNumber',
          message: 'Номер счёта должен состоять из 20 цифр (российский формат). Пробелы допускаются и игнорируются.'
        })
      }
      body.accountNumber = trimmed
    }
  }

  next()
})

// --- generic CRUD (list/read/create/delete) ---------------------------------

// Список и карточка счёта считают реальный баланс тем же SQL-выражением,
// что и /api/summary/net-worth — формула не дублируется.
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT a.*, ${CURRENT_BALANCE_EXPR} AS currentBalance FROM accounts a ORDER BY a.${TABLE_CONFIGS.accounts.defaultOrder}`
    ).all()
    res.json(rows.map(withCards))
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare(
      `SELECT a.*, ${CURRENT_BALANCE_EXPR} AS currentBalance FROM accounts a WHERE a.id = ?`
    ).get(req.params.id)
    if (!row) return res.status(404).json({ error: 'not_found' })
    res.json(withCards(row))
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

router.use((req, res, next) => {
  const json = res.json.bind(res)
  res.json = (body) => json(decorate(body))
  next()
}, createCrudRouter('accounts'))

// --- карты счёта (PAN-маски) ------------------------------------------------

// Валидация маски: 6 цифр, ≥4 плюсов, 4 цифры. Полный PAN из 16 цифр без плюсов
// отвергается — мы не храним полный номер карты.
const PAN_MASK_RE = /^\d{6}\+{4,}\d{4}$/

function badPanMask(res) {
  return res.status(400).json({
    error: 'invalid_pan_mask',
    field: 'panMask',
    message: 'Маска должна быть в формате 6 цифр + ≥4 плюсов + 4 цифры, например 220015++++++4795. Полный PAN не принимается.'
  })
}

// Список карт счёта.
router.get('/:id/cards', (req, res) => {
  const account = loadAccount(req.params.id)
  if (!account) return res.status(404).json({ error: 'not_found' })
  res.json(loadCardsForAccount(req.params.id))
})

// Добавить карту.
router.post('/:id/cards', (req, res) => {
  const account = loadAccount(req.params.id)
  if (!account) return res.status(404).json({ error: 'not_found' })

  const body = req.body || {}
  const panMask = String(body.panMask ?? '').trim()
  if (!PAN_MASK_RE.test(panMask)) return badPanMask(res)
  const label = body.label ? String(body.label).trim().slice(0, 64) : null

  const id = body.id || uuid()
  try {
    db.prepare(
      'INSERT INTO account_cards (id, accountId, panMask, label) VALUES (?, ?, ?, ?)'
    ).run(id, req.params.id, panMask, label)
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'duplicate_pan_mask', message: 'У этого счёта уже есть такая маска.' })
    }
    return res.status(400).json({ error: 'db_error', message: e.message })
  }
  res.status(201).json({ id, accountId: req.params.id, panMask, label })
})

// Удалить карту.
router.delete('/:id/cards/:cardId', (req, res) => {
  const account = loadAccount(req.params.id)
  if (!account) return res.status(404).json({ error: 'not_found' })
  const result = db.prepare(
    'DELETE FROM account_cards WHERE id = ? AND accountId = ?'
  ).run(req.params.cardId, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true, deleted: req.params.cardId })
})

export default router
