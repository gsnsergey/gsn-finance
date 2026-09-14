// Клиент БКС Торгового API.
//
// Документация: https://trade-api.bcs.ru/
// - Авторизация: POST https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token
//   form-encoded: client_id=trade-api-read, grant_type=refresh_token, refresh_token=<token>
// - Портфель:    GET https://be.broker.ru/trade-api-bff-operations/api/v1/portfolio?brokerAccountId=<id>
// - Лимиты:      GET https://be.broker.ru/trade-api-bff-operations/api/v1/limits?brokerAccountId=<id>
//
// Аутентификация:
//   refresh_token → access_token (TTL 24 часа). Каждый refresh-token
//   привязан к ОДНОМУ брокерскому счёту. Поэтому brokerAccountId в нашей
//   таблице broker_credentials — это идентификатор счёта, для которого
//   выпущен токен.
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

const KEYCLOAK_URL = 'https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token'
const BFF_BASE = 'https://be.broker.ru/trade-api-bff-operations/api/v1'

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
 * @param {string} refreshToken
 * @param {string} brokerAccountId
 * @returns {Promise<any>} сырой ответ БКС (см. normalizePosition для маппинга)
 */
export async function getPortfolio(refreshToken, brokerAccountId) {
  const accessToken = await getOrRefreshAccessToken(refreshToken, brokerAccountId)
  const url = `${BFF_BASE}/portfolio?brokerAccountId=${encodeURIComponent(brokerAccountId)}`
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
 * Нормализация позиции из ответа БКС к нашему формату holdings.
 *
 * Структура ответа БКС не публикуется как статичная OpenAPI-схема, поэтому
 * маппинг ниже сделан по аналогии с Тинькофф (broker/ticker/quantity/
 * currentValue/avgBuyPrice). При первом запуске против реального счёта
 * может потребоваться корректировка — см. тестовые ответы в Postman
 * (https://mybroker.postman.co/workspace/041e8fca-d294-4b29-b865-86430c4f5ca0).
 *
 * Принимает оба варианта: массив позиций напрямую или объект с полем positions.
 * @returns {Array<{ticker, name, quantity, currentValue, currency, brokerAccountId}>}
 */
export function normalizePosition(raw, brokerAccountId) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.positions) ? raw.positions : []
  return arr.map(p => {
    // Числа в БКС приходят как строки с фиксированной точностью ("1234.56").
    const toNum = v => {
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseFloat(v) || 0
      return 0
    }
    return {
      ticker: p.ticker || p.symbol || p.secId || '',
      name: p.name || p.shortName || p.secName || '',
      quantity: toNum(p.quantity ?? p.qty ?? p.balance ?? 0),
      // currentValue: стоимость позиции сейчас (в валюте счёта).
      // В БКС может быть поле "value" или "marketValue" или рассчитываться
      // как price * quantity — при первом запуске проверьте по ответу.
      currentValue: toNum(p.currentValue ?? p.marketValue ?? p.value ?? 0),
      avgBuyPrice: toNum(p.avgPrice ?? p.averagePrice ?? p.avgBuyPrice ?? 0),
      currency: p.currency || p.currencyCode || 'RUB',
      brokerAccountId
    }
  }).filter(p => p.ticker && p.quantity > 0)
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
      name = ?, type = ?, quantity = ?, avgBuyPrice = ?, currentPrice = ?, currentValue = ?,
      currency = ?, account = ?, updatedAt = ?
    WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO holdings (id, broker, ticker, name, type, quantity, avgBuyPrice, currentPrice, currentValue, currency, account, createdAt, updatedAt)
    VALUES (?, 'bcs', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  let upserted = 0, skipped = 0
  const tx = db.transaction(() => {
    for (const p of positions) {
      const existing = stmt.get(p.ticker, p.brokerAccountId, p.brokerAccountId)
      if (existing) {
        updateStmt.run(
          p.name, 'stock',
          p.quantity,
          Math.round(p.avgBuyPrice * 100),
          p.quantity > 0 ? Math.round((p.currentValue / p.quantity) * 100) : 0,
          Math.round(p.currentValue * 100),
          p.currency,
          p.brokerAccountId,
          now,
          existing.id
        )
        upserted++
      } else {
        insertStmt.run(
          crypto.randomUUID(),
          p.ticker, p.name, 'stock',
          p.quantity,
          Math.round(p.avgBuyPrice * 100),
          p.quantity > 0 ? Math.round((p.currentValue / p.quantity) * 100) : 0,
          Math.round(p.currentValue * 100),
          p.currency,
          p.brokerAccountId,
          now, now
        )
        upserted++
      }
    }
  })
  tx()
  return { upserted, skipped }
}