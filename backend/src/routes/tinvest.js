/**
 * POST /api/holdings/import/tinvest
 *
 * Разово подтягивает портфель из Т-Инвестиций и записывает в holdings.
 * Токен берётся из data/.env (TINKOFF_INVEST_TOKEN).
 *
 * Тело запроса (все опционально):
 *   { "dryRun": true }   — не писать в БД, только вернуть что было бы сделано
 */

import express from 'express'
import { loadDotenv, pullAll } from '../tinvest/index.js'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const env = loadDotenv()
    const token = env.TINKOFF_INVEST_TOKEN
    if (!token) {
      return res.status(400).json({
        error: 'missing_token',
        message: 'TINKOFF_INVEST_TOKEN не найден в data/.env',
      })
    }

    const dryRun = !!(req.body && req.body.dryRun)
    const summary = await pullAll(token, { dryRun })

    res.json({ ok: true, dryRun, summary })
  } catch (e) {
    res.status(500).json({ error: 'tinvest_error', message: e.message })
  }
})

export default router
