/**
 * Импорт портфеля из Т-Инвестиций (Tinkoff Invest API v2, gRPC).
 *
 * Только чтение: токен из env (TINKOFF_INVEST_TOKEN). Ходит в API через
 * UsersService.getAccounts → OperationsService.getPortfolio (+ .getOperationsByAccount
 * для расчёта средневзвешенной цены, когда Tinkoff её не вернул) +
 * InstrumentsService.getInstrumentBy / getAssetBy для FIGI→ticker и имени.
 *
 * Зависимости окружения:
 *   - TINKOFF_INVEST_TOKEN                  обязателен
 *   - GRPC_DEFAULT_SSL_ROOTS_FILE_PATH      должен указывать на PEM с Russian
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

// Базовый маппинг Tinkoff instrumentType → наш enum holdings.type
const TYPE_MAP = {
  share: 'stock',
  etf: 'etf',
  bond: 'bond_corp',     // refine в bond_ofz/bond_corp через getAssetBy
  currency: 'other',
  gold: 'metal',
  futures: 'future',
  option: 'option',
  sp: 'fund',            // структурный продукт
  fx: 'other',
}

// Уточнение bond: getAssetBy возвращает {instrumentType, ...} где для bond есть
// sector, code (ОФЗ обычно UXXXXXX). Здесь простая эвристика: код облигации
// начинается с 0 или принадлежит серии "ofz".
function refineBondType(instrumentUid, assetInfo) {
  if (!assetInfo) return 'bond_corp'
  const isin = assetInfo.isin || ''
  const code = assetInfo.code || ''
  const sector = assetInfo.sector || ''
  // ОФЗ: код серии содержит "ofz" или ISIN вида RU000A0XXX
  if (/ofz/i.test(code) || /ofz/i.test(sector) || /ofz/i.test(assetInfo.type || '')) return 'bond_ofz'
  if (/^RU000A0[A-Z]?/i.test(isin)) return 'bond_ofz'  // эвристика по ISIN
  return 'bond_corp'
}

// Парсер .env: кавычки ('...' / "..."), комментарии (#), \r\n
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
  return Number(mv.units || 0) + Number(mv.nano || 0) / 1e9
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) }
  catch { return {} }
}

function writeCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

// gRPC enum InstrumentIdType: 1 = FIGI, 3 = UID
const ID_TYPE_FIGI = 1

// Достаём расширенную информацию об инструменте: ticker, name, currency, type.
// Кеш в data/instruments-cache.json по figi или uid.
async function enrichInstrument(api, figi, uid, tickerFromPosition) {
  const cache = readCache()
  const key = uid || figi
  if (cache[key]) return cache[key]

  // Сначала пробуем по UID (новый API), fallback на FIGI
  let instrument = null
  try {
    if (uid) {
      const r = await api.instruments.getInstrumentBy({ idType: 3, id: uid })
      instrument = r.instrument
    }
  } catch { /* fallback ниже */ }
  if (!instrument) {
    const r = await api.instruments.getInstrumentBy({ idType: ID_TYPE_FIGI, id: figi })
    instrument = r.instrument
  }

  const entry = {
    ticker: instrument.ticker || tickerFromPosition || figi,
    name: instrument.name || null,
    currency: (instrument.currency || '').toUpperCase() || 'RUB',
    tinkoffType: instrument.instrumentType,
    instrumentUid: instrument.uid || uid || null,
  }
  cache[key] = entry
  // Дублируем в кеше по figi, чтобы последующие вызовы по FIGI тоже попадали
  if (figi && figi !== key) cache[figi] = entry
  writeCache(cache)
  return entry
}

// Для bond — уточнить подтип (ОФЗ vs корпоративная) через getAssetBy
async function enrichAsset(api, instrumentUid) {
  if (!instrumentUid) return null
  const cache = readCache()
  const cacheKey = `asset:${instrumentUid}`
  if (cache[cacheKey]) return cache[cacheKey]
  try {
    const { asset } = await api.instruments.getAssetBy({ id: instrumentUid })
    cache[cacheKey] = asset
    writeCache(cache)
    return asset
  } catch {
    return null
  }
}

// Возвращает Map<figi, avgBuyPrice> — средневзвешенная из операций покупки.
// null в Map — Tinkoff не вернул операций по этой FIGI.
async function fetchAvgPriceFromOperations(api, accountId, figis) {
  if (figis.length === 0) return new Map()
  const out = new Map()
  try {
    // Берём операции за последние 5 лет (на практике большинству хватает)
    const { operations = [] } = await api.operations.getOperationsByAccount({
      accountId,
      from: new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString(),
      to: new Date().toISOString(),
      state: 'OPERATION_STATE_EXECUTED',
    })
    const buys = new Map()   // figi -> { qty, cost }
    const sells = new Map()  // figi -> qty
    for (const op of operations) {
      if (op.operationType !== 'OPERATION_TYPE_BUY' && op.operationType !== 'OPERATION_TYPE_SELL') continue
      const f = op.figi
      if (!f || !figis.includes(f)) continue
      const qty = moneyToNumber(op.quantity)
      const price = moneyToNumber(op.price)
      if (op.operationType === 'OPERATION_TYPE_BUY') {
        const cur = buys.get(f) || { qty: 0, cost: 0 }
        cur.qty += qty
        cur.cost += qty * price
        buys.set(f, cur)
      } else {
        sells.set(f, (sells.get(f) || 0) + qty)
      }
    }
    for (const f of figis) {
      const b = buys.get(f)
      if (b && b.qty > 0) {
        const sold = sells.get(f) || 0
        const remainingQty = b.qty - sold
        if (remainingQty > 0) out.set(f, b.cost / b.qty)  // средневзвешенная покупки
      }
    }
  } catch (e) {
    // Ошибка запроса операций — не критично, оставляем Map пустым
  }
  return out
}

export function createClient(token) {
  if (!token) throw new Error('TINKOFF_INVEST_TOKEN is empty. Проверь data/.env')
  return new TinkoffInvestApi({ token, appName: 'finans.import' })
}

// Один счёт → массив нормализованных записей (без записи в БД).
export async function fetchAccountPortfolio(api, account, { currency = 'RUB' } = {}) {
  const { positions = [] } = await api.operations.getPortfolio({
    accountId: account.id,
    currency,
  })

  // Шаг 1: собираем уникальные FIGI, требующие enrich (нет ticker в позиции или ticker==figi)
  const needEnrich = []
  for (const pos of positions) {
    if (!pos.figi) continue
    if (!pos.ticker || pos.ticker === pos.figi) needEnrich.push(pos)
  }
  // Параллельный enrich
  await Promise.all(needEnrich.map(async (pos) => {
    const inst = await enrichInstrument(api, pos.figi, pos.instrumentUid, pos.ticker)
    pos._enriched = inst
  }))

  // Шаг 2: для bond — уточнить подтип через getAssetBy
  const bondUids = [...new Set(
    needEnrich
      .filter(p => p._enriched?.tinkoffType === 'bond' && p._enriched.instrumentUid)
      .map(p => p._enriched.instrumentUid)
  )]
  const assets = new Map()
  await Promise.all(bondUids.map(async (uid) => {
    const a = await enrichAsset(api, uid)
    assets.set(uid, a)
  }))

  // Шаг 3: для FIGI где avgBuyPrice=0 — fallback через getOperationsByAccount
  const zeroAvgFigis = positions
    .filter(p => p.figi && moneyToNumber(p.averagePositionPrice) === 0 && moneyToNumber(p.quantity) > 0)
    .map(p => p.figi)
  const fallbackAvg = await fetchAvgPriceFromOperations(api, account.id, zeroAvgFigis)

  // Шаг 4: собираем записи
  const out = []
  for (const pos of positions) {
    const figi = pos.figi
    if (!figi) continue
    const qty = moneyToNumber(pos.quantity)
    if (qty === 0) continue

    try {
      const inst = pos._enriched || await enrichInstrument(api, figi, pos.instrumentUid, pos.ticker)
      let avgBuyPrice = moneyToNumber(pos.averagePositionPrice)
      if (avgBuyPrice === 0) {
        const fb = fallbackAvg.get(figi)
        if (fb != null) avgBuyPrice = fb
      }
      const currentPrice = moneyToNumber(pos.currentPrice) || avgBuyPrice  // fallback если currentPrice тоже 0
      const totalCost = qty * avgBuyPrice
      const currentValue = qty * currentPrice
      const profit = currentValue - totalCost
      const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : 0

      let type = TYPE_MAP[inst.tinkoffType || pos.instrumentType] || 'other'
      if (inst.tinkoffType === 'bond' && inst.instrumentUid) {
        type = refineBondType(inst.instrumentUid, assets.get(inst.instrumentUid))
      }

      out.push({
        broker: BROKER,
        account: account.name,
        accountId: account.id,
        figi,
        ticker: inst.ticker,
        name: inst.name,
        quantity: qty,
        avgBuyPrice,
        currentPrice,
        totalCost,
        currentValue,
        profit,
        profitPct,
        currency: inst.currency || 'RUB',
        type,
        blocked: pos.blocked ? 1 : 0,
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
       SET quantity = ?, avgBuyPrice = ?, currentPrice = ?, totalCost = ?, currentValue = ?, profit = ?, profitPct = ?, currency = ?, type = ?, name = ?, blocked = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      record.quantity, record.avgBuyPrice, record.currentPrice,
      record.totalCost, record.currentValue, record.profit, record.profitPct,
      record.currency, record.type, record.name, record.blocked, now,
      existing.id
    )
    return { action: 'updated', id: existing.id }
  }

  const id = uuid()
  db.prepare(
    `INSERT INTO holdings (id, broker, type, ticker, name, quantity, avgBuyPrice, currentPrice, totalCost, currentValue, profit, profitPct, currency, account, blocked, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, record.broker, record.type, record.ticker, record.name,
    record.quantity, record.avgBuyPrice, record.currentPrice,
    record.totalCost, record.currentValue, record.profit, record.profitPct,
    record.currency, record.account, record.blocked,
    now, now
  )
  return { action: 'created', id }
}

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
        summary.created++
        accLog.created++
        accLog.positions.push({ ticker: rec.ticker, qty: rec.quantity, action: 'would-create' })
        continue
      }
      try {
        const r = upsertHolding(rec)
        if (r.action === 'created') { summary.created++; accLog.created++ }
        else { summary.updated++; accLog.updated++ }
        accLog.positions.push({
          ticker: rec.ticker, qty: rec.quantity,
          price: `${rec.avgBuyPrice.toFixed(2)}/${rec.currentPrice.toFixed(2)}`,
          action: r.action,
        })
      } catch (e) {
        accLog.skipped++
        summary.skipped++
        summary.errors.push({ account: account.name, ticker: rec.ticker, error: e.message })
      }
    }
  }

  return summary
}
