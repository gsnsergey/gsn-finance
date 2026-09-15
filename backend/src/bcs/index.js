// Клиент БКС Торгового API.
//
// Документация: https://trade-api.bcs.ru/  (PDF: https://cdn.bcs.ru/static/bcs/files/trade-api-docs.pdf)
//
// Эндпоинты (по сервисам, у каждого свой под-путь):
// - Авторизация (Keycloak): POST https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token
//   form-encoded: client_id=trade-api-read, grant_type=refresh_token, refresh_token=<token>
// - Портфель:   GET https://be.broker.ru/trade-api-bff-portfolio/api/v1/portfolio (без query — счёт берётся из токена)
// - Лимиты:     GET https://be.broker.ru/trade-api-bff-limit/api/v1/limits
// - Счета:      GET https://be.broker.ru/trade-api-bff-operations/api/v1/accounts
// - Заявки:     POST https://be.broker.ru/trade-api-bff-operations/api/v1/orders
//
// Аутентификация:
//   refresh_token → access_token (TTL 24 часа). Каждый refresh-token
//   привязан к ОДНОМУ брокерскому счёту. Поэтому brokerAccountId в нашей
//   таблице broker_credentials — это идентификатор счёта, для которого
//   выпущен токен (нужен для UI и для будущей фильтрации портфеля, но
//   сам /portfolio его не принимает — счёт определяется токеном).
//
// ВАЖНО — про схему ответа:
//   Эта реализация делает минимальный маппинг ответа БКС → наши holdings.
//   Реальные названия полей в ответах БКС надо проверить по
//   https://trade-api.bcs.ru/http/portfolio — там динамическая страница,
//   JSON-схема не отдаётся напрямую. Если маппинг не совпадёт —
//   скорректируйте функцию normalizePosition() ниже.
//
// Реализация держит access_token в памяти (Map по brokerAccountId) на 24h.
// При 401 — переавторизуется автоматически один раз.

import db from '../db.js'

// Базовые URL-ы сервисов БКС (по Go-SDK https://pkg.go.dev/github.com/diekinari/bcs-trade-go).
// У БКС у каждого сервиса свой путь-префикс на одном хосте be.broker.ru.
const BCS_PORTS = {
  auth:      'https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token',
  portfolio: 'https://be.broker.ru/trade-api-bff-portfolio/api/v1',
  limits:    'https://be.broker.ru/trade-api-bff-limit/api/v1',
  operations:'https://be.broker.ru/trade-api-bff-operations/api/v1',
  marketData:'https://be.broker.ru/trade-api-market-data-connector/api/v1'
}

const KEYCLOAK_URL = BCS_PORTS.auth
// BFF_BASE оставлен для обратной совместимости, но /portfolio использует свой BCS_PORTS.portfolio
const BFF_BASE = BCS_PORTS.operations

// in-memory cache: key = `bcs:${brokerAccountId}` → { accessToken, expiresAt }
const accessTokenCache = new Map()

/**
 * Обмен refresh_token на access_token через Keycloak.
 * @param {string} refreshToken
 * @returns {Promise<{access_token: string, expires_in: number}>}
 */
export async function authenticate(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: 'trade-api-read',
    refresh_token: refreshToken
  })
  const res = await fetch(KEYCLOAK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`BCS auth ${res.status}: ${text || res.statusText}`)
  }
  return res.json()
}

/**
 * Получить портфель по brokerAccountId.
 * Автоматически обменивает refresh_token на access_token (с кешем на 24h).
 *
 * Эндпоинт `/trade-api-bff-portfolio/api/v1/portfolio` НЕ принимает
 * brokerAccountId query — счёт определяется токеном. brokerAccountId
 * нужен только для маршрутизации кеша access_token (один токен → один счёт).
 *
 * @param {string} refreshToken
 * @param {string} brokerAccountId
 * @returns {Promise<any>} сырой ответ БКС (см. normalizePosition для маппинга)
 */
export async function getPortfolio(refreshToken, brokerAccountId) {
  const accessToken = await getOrRefreshAccessToken(refreshToken, brokerAccountId)
  const url = `${BCS_PORTS.portfolio}/portfolio`
  let res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  })
  if (res.status === 401) {
    // access token протух или инвалидирован — переавторизуемся один раз
    accessTokenCache.delete(`bcs:${brokerAccountId}`)
    const newToken = await getOrRefreshAccessToken(refreshToken, brokerAccountId)
    res = await fetch(url, { headers: { 'Authorization': `Bearer ${newToken}` } })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`BCS portfolio ${res.status}: ${text || res.statusText}`)
  }
  return res.json()
}

/**
 * Маппинг BCS `instrumentType` → наш `type` (см. миграцию 005_holdings_broker_fields.sql
 * для полного enum: 'stock', 'etf', 'fund', 'bond_ofz', 'bond_corp', 'eurobond', и т.д.).
 */
function bcsInstrumentToOurType(instrumentType) {
  switch (instrumentType) {
    case 'STOCK':       return 'stock'
    case 'ETF':         return 'etf'
    case 'MUTUAL_FUNDS':return 'fund'
    case 'BONDS':       return 'bond_corp'   // без разделения на OFZ/корп. в БКС API
    case 'EURO_BONDS':  return 'eurobond'
    case 'FUTURES':     return 'future'
    case 'OPTIONS':     return 'option'
    case 'METALS':      return 'metal'
    default:            return 'other'
  }
}

/**
 * Нормализация позиции из ответа БКС к нашему формату holdings.
 *
 * /portfolio возвращает JSON-массив, где две «природы» записей:
 *   - type='moneyLimit'  → денежный остаток по sub-account (RUB/USD/...) — это НЕ позиция,
 *                           пропускаем (его место в `accounts.balance`, а не в `holdings`).
 *   - type='depoLimit'   → ценные бумаги на депо-счёте — это то, что нам нужно.
 *
 * Тикер у облигаций/фондов в БКС приходит как ISIN (RU000...). Чтобы UI
 * показывал привычные тикеры, нужна таблица ISIN → ticker; это отдельная задача.
 *
 * См. реальный ответ: type, subAccountId, agreementId, account, exchange,
 *   ticker, displayName, baseAssetTicker, currency, upperType, instrumentType,
 *   term, quantity, locked, balancePrice, currentPrice, balanceValue,
 *   currentValue, unrealizedPL, ...
 *
 * @returns {Array<{ticker, name, type, quantity, avgBuyPrice, currentValue, currency, brokerAccountId}>}
 */
export function normalizePosition(raw, brokerAccountId) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.positions) ? raw.positions : []
  return arr
    .filter(p => {
      // Skip cash positions — they belong to accounts.balance, not holdings.
      // Без этого фильтра в портфеле появляются «акции RUB» с quantity=26751.96.
      if (p.type === 'moneyLimit') return false
      // Skip closed/zero positions
      const q = typeof p.quantity === 'number' ? p.quantity : parseFloat(p.quantity) || 0
      if (q <= 0) return false
      return true
    })
    .map(p => {
      const toNum = v => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0)
      return {
        ticker: p.ticker || p.symbol || p.secId || '',
        name: p.displayName || p.shortName || p.name || p.secName || '',
        type: bcsInstrumentToOurType(p.instrumentType),
        quantity: toNum(p.quantity),
        // balancePrice — средняя цена покупки (наш avgBuyPrice)
        avgBuyPrice: toNum(p.balancePrice ?? p.avgPrice ?? p.averagePrice ?? 0),
        // currentValue — стоимость позиции сейчас в валюте счёта
        currentValue: toNum(p.currentValue ?? p.currentValueRub ?? p.marketValue ?? p.value ?? 0),
        currency: p.currency || p.currencyCode || 'RUB',
        brokerAccountId
      }
    })
    .filter(p => p.ticker)
}

async function getOrRefreshAccessToken(refreshToken, brokerAccountId) {
  const cacheKey = `bcs:${brokerAccountId}`
  const cached = accessTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken
  const { access_token, expires_in } = await authenticate(refreshToken)
  const expiresAt = Date.now() + (expires_in || 86400) * 1000
  accessTokenCache.set(cacheKey, { accessToken: access_token, expiresAt })
  return access_token
}

/**
 * Записать позиции БКС в нашу таблицу holdings (upsert по broker+ticker+account).
 * Перенесённая логика из backend/src/tinvest/index.js.
 *
 * @param {Array<{ticker, name, quantity, currentValue, avgBuyPrice, currency, brokerAccountId}>} positions
 * @returns {{upserted: number, skipped: number}}
 */
export function upsertHoldings(positions) {
  const stmt = db.prepare(`
    SELECT id FROM holdings
    WHERE broker = 'bcs' AND ticker = ? AND (account = ? OR (account IS NULL AND ? IS NULL))
  `)
  const updateStmt = db.prepare(`
    UPDATE holdings SET
      name = ?, type = ?, quantity = ?, avgBuyPrice = ?, currentPrice = ?,
      totalCost = ?, currentValue = ?, profit = ?, profitPct = ?,
      currency = ?, account = ?, updatedAt = ?
    WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO holdings (id, broker, type, ticker, name, quantity, avgBuyPrice, currentPrice, totalCost, currentValue, profit, profitPct, currency, account, createdAt, updatedAt)
    VALUES (?, 'bcs', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  let upserted = 0, skipped = 0
  const tx = db.transaction(() => {
    for (const p of positions) {
      // Все денежные поля — в КОПЕЙКАХ (как у Тинькофф и как ждёт UI/`rub()`).
      const avgBuyPriceKp = Math.round(p.avgBuyPrice * 100)
      const currentValueKp = Math.round(p.currentValue * 100)
      const currentPriceKp = p.quantity > 0 ? Math.round(currentValueKp / p.quantity) : 0
      // totalCost/profit/profitPct считаем так же, как при импорте Тинькофф.
      // Раньше БКС их вообще не писал — в портфеле не было прибыли и процента.
      const totalCostKp = Math.round(p.quantity * p.avgBuyPrice * 100)
      const profitKp = currentValueKp - totalCostKp
      const profitPct = totalCostKp > 0 ? (profitKp / totalCostKp) * 100 : 0
      // type из normalizePosition (акция/облигация/ETF/…), иначе всё писалось «Акция».
      const type = p.type || 'stock'

      const existing = stmt.get(p.ticker, p.brokerAccountId, p.brokerAccountId)
      if (existing) {
        updateStmt.run(
          p.name, type, p.quantity, avgBuyPriceKp, currentPriceKp,
          totalCostKp, currentValueKp, profitKp, profitPct,
          p.currency, p.brokerAccountId, now, existing.id
        )
        upserted++
      } else {
        insertStmt.run(
          crypto.randomUUID(), type, p.ticker, p.name, p.quantity,
          avgBuyPriceKp, currentPriceKp, totalCostKp, currentValueKp, profitKp, profitPct,
          p.currency, p.brokerAccountId, now, now
        )
        upserted++
      }
    }
  })
  tx()
  return { upserted, skipped }
}