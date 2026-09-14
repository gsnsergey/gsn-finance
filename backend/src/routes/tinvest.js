/**
 * POST /api/holdings/import/tinvest
 *
 * Разово подтягивает портфель из Т-Инвестиций и записывает в holdings.
 *
 * Где берётся токен (порядок fallback):
 *   1) broker_credentials WHERE provider='tinkoff' (Настройки → Интеграции)
 *   2) TINKOFF_INVEST_TOKEN в data/.env (legacy)
 *   3) 400 missing_token
 *
 * Если токен взят из env — в ответе есть `tokenSource: 'env'`, чтобы UI
 * мог показать баннер «Перенесите токен в Настройки → Интеграции».
 *
 * Тело запроса (все опционально):
 *   { "dryRun": true }   — не писать в БД, только вернуть что было бы сделано
 */

import express from 'express'
import db from '../db.js'
import { decryptSecret } from '../lib/secretStore.js'
import { loadDotenv, pullAll } from '../tinvest/index.js'

const router = express.Router()

function getTinkoffTokenFromDb() {
  const rows = db.prepare(
    "SELECT tokenCiphertext FROM broker_credentials WHERE provider = 'tinkoff' ORDER BY createdAt LIMIT 1"
  ).all()
  if (rows.length === 0) return null
  try {
    return decryptSecret(rows[0].tokenCiphertext)
  } catch {
    return null
  }
}

router.post('/', async (req, res) => {
  let token = getTinkoffTokenFromDb()
  let tokenSource = 'db'
  if (!token) {
    const env = loadDotenv()
    token = env.TINKOFF_INVEST_TOKEN
    if (!token) {
      return res.status(400).json({
        error: 'missing_token',
        message: 'Токен Т-Инвестиций не найден. Добавьте его в Настройки → Интеграции.'
      })
    }
    tokenSource = 'env'
  }

  const dryRun = !!(req.body && req.body.dryRun)
  try {
    const summary = await pullAll(token, { dryRun })
    res.json({ ok: true, dryRun, tokenSource, summary })
  } catch (e) {
    res.status(500).json({ error: 'tinvest_error', message: e.message })
  }
})

export default router