/**
 * Импорт портфеля из Т-Инвестиций (Tinkoff Invest API v2, gRPC).
 *
 * Только чтение: токен берётся из env (TINKOFF_INVEST_TOKEN), ходит в API
 * через UsersService.getAccounts → OperationsService.getPortfolio, мапит
 * позиции в таблицу holdings.
 *
 * Зависимости окружения:
 *   - TINKOFF_INVEST_TOKEN  — обязателен
 *   - GRPC_DEFAULT_SSL_ROOTS_FILE_PATH — должен указывать на PEM с Russian
 *     Trusted Root CA (для TLS до invest-public-api.tinkoff.ru). На macOS
 *     bin/ctl пробрасывает data/russian-trusted-root-ca.pem автоматически.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TinkoffInvestApi } from 'tinkoff-invest-api'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const ENV_PATH = path.join(ROOT, 'data/.env')
const CACHE_PATH = path.join(ROOT, 'data/instruments-cache.json')
const BROKER = 't-invest'

// Маппинг Tinkoff instrumentType → наш enum holdings.type
const TYPE_MAP = {
  share: 'stock',
  etf: 'etf',
  bond: 'bond_corp',  // по умолчанию корпоративная; ОФЗ приходят тем же типом — refine по figi/assetUid при необходимости
  currency: 'other',
  gold: 'metal',
  futures: 'future',
  option: 'option',
  sp: 'fund',         // структурный продукт
  fx: 'other',
}

// Парсер .env: понимает кавычки ('...' / "..."), комментарии (#), \r\n
export function parseDotenv(raw) {
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[m[1]] = value
  }
  return env
}

export function loadDotenv() {
  if (!fs.existsSync(ENV_PATH)) return {}
  return parseDotenv(fs.readFileSync(ENV_PATH, 'utf8'))
}

function moneyToNumber(mv) {
  if (mv == null) return 0
  const units = Number(mv.units || 0)
  const nano = Number(mv.nano || 0)
  return units + nano / 1e9
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

// FIGI → { ticker, name, currency, type } с кешем в data/instruments-cache.json.
// Если Tinkoff уже вернул ticker в позиции (и он отличается от FIGI) — берём оттуда.
async function resolveInstrument(api, figi, tickerFromPosition) {
  if (tickerFromPosition && tickerFromPosition !== figi) {
    return { ticker: tickerFromPosition, fromCache: false }
  }
  const cache = readCache()
  if (cache[figi]) return { ...cache[figi], fromCache: true }
  // gRPC enum требует числовое значение: 1 = INSTRUMENT_ID_TYPE_FIGI, 3 = UID
  const { instrument } = await api.instruments.getInstrumentBy({
    idType: 1,
    id: figi,
  })
  const entry = {
    ticker: instrument.ticker,
    name: instrument.name,
    currency: instrument.currency?.toUpperCase() || 'RUB',
    tinkoffType: instrument.instrumentType,
  }
  cache[figi] = entry
  writeCache(cache)
  return { ...entry, fromCache: false }
}

export function createClient(token) {
  if (!token) throw new Error('TINKOFF_INVEST_TOKEN is empty. Проверь data/.env')
  return new TinkoffInvestApi({ token, appName: 'finans.import' })
}

// Один счёт → массив нормализованных записей (без записи в БД).
export async function fetchAccountPortfolio(api, account, { currency = 'RUB' } = {}) {
  const { positions = [] } = await api.operations.getPortfolio({
    accountId: account.id,
    currency: 'RUB',  // gRPC enum, RUB строкой допустим в tinkoff-invest-api
  })
  const out = []
  for (const pos of positions) {
    const figi = pos.figi
    if (!figi) continue
    const qty = moneyToNumber(pos.quantity)
    if (qty === 0) continue

    try {
      const inst = await resolveInstrument(api, figi, pos.ticker)
      const avgPrice = moneyToNumber(pos.averagePositionPrice)
      out.push({
        broker: BROKER,
        account: account.name,
        accountId: account.id,
        figi,
        ticker: inst.ticker,
        name: pos.instrumentUid ? null : (inst.name || null), // instrumentUid вместо имени в новом API
        quantity: qty,
        avgPrice,
        currency: inst.currency || 'RUB',
        type: TYPE_MAP[inst.tinkoffType || pos.instrumentType] || 'other',
        instrumentType: pos.instrumentType,
        blocked: !!pos.blocked,
      })
    } catch (e) {
      out.push({ error: e.message, figi, account: account.name })
    }
  }
  return out
}

function upsertHolding(record) {
  const existing = db.prepare(
    `SELECT id FROM holdings WHERE broker = ? AND ticker = ? AND account = ?`
  ).get(record.broker, record.ticker, record.account)

  const now = new Date().toISOString()

  if (existing) {
    db.prepare(
      `UPDATE holdings
       SET quantity = ?, avgPrice = ?, currency = ?, type = ?, updatedAt = ?
       WHERE id = ?`
    ).run(record.quantity, record.avgPrice, record.currency, record.type, now, existing.id)
    return { action: 'updated', id: existing.id }
  }

  const id = uuid()
  db.prepare(
    `INSERT INTO holdings (id, broker, type, ticker, name, quantity, avgPrice, currency, account, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, record.broker, record.type, record.ticker, record.name,
    record.quantity, record.avgPrice, record.currency, record.account,
    now, now
  )
  return { action: 'created', id }
}

// Главная точка входа. Возвращает итог: счётчики + список ошибок.
export async function pullAll(token, opts = {}) {
  const api = createClient(token)
  const { accounts } = await api.users.getAccounts({})

  const summary = {
    accountsScanned: 0,
    accounts: [],
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  for (const account of accounts) {
    summary.accountsScanned++
    const accLog = {
      id: account.id,
      name: account.name,
      type: account.type,
      status: account.status,
      created: 0, updated: 0, skipped: 0,
      positions: [],
    }
    summary.accounts.push(accLog)

    let records
    try {
      records = await fetchAccountPortfolio(api, account)
    } catch (e) {
      accLog.error = e.message
      summary.errors.push({ account: account.name, error: e.message })
      continue
    }

    for (const rec of records) {
      if (rec.error) {
        accLog.skipped++
        summary.skipped++
        summary.errors.push({ account: account.name, figi: rec.figi, error: rec.error })
        continue
      }
      if (opts.dryRun) {
        // DRY-RUN: не пишем в БД, только учитываем что было бы сделано
        // Новые vs обновлённые различить нельзя без запроса — поэтому всё считаем «новыми»
        summary.created++
        accLog.created++
        accLog.positions.push({ ticker: rec.ticker, qty: rec.quantity, action: 'would-create' })
        continue
      }
      try {
        const r = upsertHolding(rec)
        if (r.action === 'created') { summary.created++; accLog.created++ }
        else { summary.updated++; accLog.updated++ }
        accLog.positions.push({ ticker: rec.ticker, qty: rec.quantity, action: r.action })
      } catch (e) {
        accLog.skipped++
        summary.skipped++
        summary.errors.push({ account: account.name, ticker: rec.ticker, error: e.message })
      }
    }
  }

  return summary
}
