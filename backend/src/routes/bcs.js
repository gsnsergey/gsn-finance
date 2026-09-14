/**
 * POST /api/holdings/import/bcs
 *
 * Разово подтягивает портфель из БКС по brokerAccountId и записывает в holdings.
 *
 * Где берётся токен (refresh_token):
 *   broker_credentials WHERE provider='bcs' AND brokerAccountId = <brokerAccountId>
 *   401 missing_credentials, если записи нет.
 *
 * Тело запроса:
 *   { "brokerAccountId": "L01xxx", "dryRun": true }   // dryRun — не писать в БД
 *
 * ПРИМЕЧАНИЕ: маппинг ответа БКС к нашему формату см. в bcs/index.js
 * (normalizePosition). Если поля не совпадают — откройте задачу и пришлите
 * пример реального ответа (можно из Postman коллекции БКС).
 */

import express from 'express'
import db from '../db.js'
import { decryptSecret } from '../lib/secretStore.js'
import { getPortfolio, normalizePosition, upsertHoldings } from '../bcs/index.js'

const router = express.Router()

function getBcsRefreshToken(brokerAccountId) {
  const row = db.prepare(
    "SELECT tokenCiphertext FROM broker_credentials WHERE provider = 'bcs' AND brokerAccountId = ?"
  ).get(brokerAccountId)
  if (!row) return null
  try { return decryptSecret(row.tokenCiphertext) } catch { return null }
}

router.post('/', async (req, res) => {
  const body = req.body || {}
  const brokerAccountId = String(body.brokerAccountId ?? '').trim()
  const dryRun = !!body.dryRun

  if (!brokerAccountId) {
    return res.status(400).json({
      error: 'missing_brokerAccountId',
      message: 'Укажите brokerAccountId — id счёта БКС, для которого выпущен токен.'
    })
  }

  const refreshToken = getBcsRefreshToken(brokerAccountId)
  if (!refreshToken) {
    return res.status(401).json({
      error: 'missing_credentials',
      message: `Для счёта ${brokerAccountId} нет токена. Добавьте его в Настройки → Интеграции.`
    })
  }

  let raw
  try {
    raw = await getPortfolio(refreshToken, brokerAccountId)
  } catch (e) {
    // Логируем lastError, но не ломаем сервис
    try {
      db.prepare(
        'UPDATE broker_credentials SET lastError = ?, updatedAt = ? WHERE provider = ? AND brokerAccountId = ?'
      ).run(e.message, new Date().toISOString(), 'bcs', brokerAccountId)
    } catch {}
    return res.status(502).json({ error: 'bcs_error', message: e.message })
  }

  const positions = normalizePosition(raw, brokerAccountId)
  if (!dryRun) {
    const result = upsertHoldings(positions)
    try {
      db.prepare(
        'UPDATE broker_credentials SET lastUsedAt = ?, lastError = NULL, updatedAt = ? WHERE provider = ? AND brokerAccountId = ?'
      ).run(new Date().toISOString(), new Date().toISOString(), 'bcs', brokerAccountId)
    } catch {}
    res.json({ ok: true, dryRun, positions: positions.length, upserted: result.upserted })
  } else {
    res.json({ ok: true, dryRun, positions })
  }
})

export default router