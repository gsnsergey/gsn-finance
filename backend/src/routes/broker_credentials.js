// CRUD для таблицы broker_credentials (см. миграцию 008).
//
// ВАЖНО — безопасность:
// - GET (список/один): возвращает `tokenMask: '••••••••ABCD'` —
//   сам токен НЕ отдаётся, чтобы не «протекал» через UI.
// - POST/PATCH: возвращает запись целиком (с открытым `token`),
//   потому что UI должен знать, что сохранил. Это эхо, без чтения из БД.
// - Удаление требует явного DELETE.

import express from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { encryptSecret, decryptSecret, maskOf } from '../lib/secretStore.js'

const router = express.Router()

const ALLOWED_PROVIDERS = ['tinkoff', 'bcs', 'finam', 'other']
const PAN_MASK_RE_FOR_LABEL = /^.{1,64}$/ // label — произвольная строка до 64 символов

function rowToListItem(row) {
  // GET — без расшифровки, только маска. lastError и lastUsedAt показываем.
  return {
    id: row.id,
    provider: row.provider,
    brokerAccountId: row.brokerAccountId,
    label: row.label,
    tokenMask: '••••••••' + decryptMaskSuffix(row.tokenCiphertext),
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

// Расшифровываем только чтобы достать последние 4 символа для маски.
// Это нагружает CPU на каждый GET, но записей немного (<100), приемлемо.
function decryptMaskSuffix(b64) {
  try {
    const plain = decryptSecret(b64)
    return plain.slice(-4)
  } catch {
    return '????'
  }
}

function rowToFullItem(row) {
  // Только для POST/PATCH эхо. Содержит открытый `token`.
  const token = decryptSecret(row.tokenCiphertext)
  return {
    id: row.id,
    provider: row.provider,
    brokerAccountId: row.brokerAccountId,
    label: row.label,
    token, // открытый
    tokenMask: maskOf(token),
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

// --- list ---
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM broker_credentials
      ORDER BY provider, brokerAccountId
    `).all()
    res.json(rows.map(rowToListItem))
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// --- one ---
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM broker_credentials WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'not_found' })
    res.json(rowToListItem(row))
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// --- create ---
router.post('/', (req, res) => {
  const body = req.body || {}
  const provider = String(body.provider ?? '')
  const brokerAccountId = String(body.brokerAccountId ?? '').trim()
  const label = body.label ? String(body.label).trim() : null
  const token = String(body.token ?? '').trim()

  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'invalid_provider', message: `provider должен быть одним из ${ALLOWED_PROVIDERS.join(', ')}` })
  }
  if (!brokerAccountId) return res.status(400).json({ error: 'missing_brokerAccountId', field: 'brokerAccountId' })
  if (!token) return res.status(400).json({ error: 'missing_token', field: 'token' })
  if (label && !PAN_MASK_RE_FOR_LABEL.test(label)) {
    return res.status(400).json({ error: 'invalid_label', message: 'label должен быть до 64 символов' })
  }

  const id = uuid()
  const now = new Date().toISOString()
  try {
    const ciphertext = encryptSecret(token)
    db.prepare(`
      INSERT INTO broker_credentials (id, provider, brokerAccountId, label, tokenCiphertext, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, provider, brokerAccountId, label, ciphertext, now, now)
    const row = db.prepare('SELECT * FROM broker_credentials WHERE id = ?').get(id)
    res.status(201).json(rowToFullItem(row))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'duplicate', message: `Запись для ${provider}:${brokerAccountId} уже есть.` })
    }
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// --- update (label и/или token) ---
router.patch('/:id', (req, res) => {
  const body = req.body || {}
  const row = db.prepare('SELECT * FROM broker_credentials WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  const updates = []
  const values = []

  if (body.label !== undefined) {
    const label = body.label ? String(body.label).trim() : null
    if (label && !PAN_MASK_RE_FOR_LABEL.test(label)) {
      return res.status(400).json({ error: 'invalid_label', message: 'label должен быть до 64 символов' })
    }
    updates.push('label = ?')
    values.push(label)
  }
  if (body.token !== undefined) {
    const token = String(body.token ?? '').trim()
    if (!token) return res.status(400).json({ error: 'missing_token', field: 'token' })
    updates.push('tokenCiphertext = ?')
    values.push(encryptSecret(token))
  }
  if (body.brokerAccountId !== undefined) {
    const brokerAccountId = String(body.brokerAccountId).trim()
    if (!brokerAccountId) return res.status(400).json({ error: 'missing_brokerAccountId' })
    updates.push('brokerAccountId = ?')
    values.push(brokerAccountId)
  }

  if (updates.length === 0) return res.json(rowToListItem(row))

  updates.push('updatedAt = ?')
  values.push(new Date().toISOString())
  values.push(req.params.id)
  try {
    db.prepare(`UPDATE broker_credentials SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const newRow = db.prepare('SELECT * FROM broker_credentials WHERE id = ?').get(req.params.id)
    // При обновлении токена — вернуть полную запись (UI нужно подтверждение).
    if (body.token !== undefined) return res.json(rowToFullItem(newRow))
    res.json(rowToListItem(newRow))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'duplicate', message: 'Дубль по (provider, brokerAccountId).' })
    }
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// --- delete ---
router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM broker_credentials WHERE id = ?').run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, deleted: req.params.id })
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message })
  }
})

// --- discover BCS accounts (хелпер для подбора brokerAccountId) ---
// Не требует сохранённого токена: токен приходит в теле запроса, мы обмениваем
// его через Keycloak и возвращаем список id+name из /accounts.
// Это решает замкнутый круг: раньше, чтобы получить brokerAccountId,
// нужно было сначала его ввести в форму.
router.post('/discover-bcs-accounts', async (req, res) => {
  const body = req.body || {}
  const token = String(body.token ?? '').trim()
  if (!token) {
    return res.status(400).json({ error: 'missing_token', message: 'Передайте refresh_token в теле запроса' })
  }
  try {
    const { authenticate } = await import('../bcs/index.js')
    const { access_token } = await authenticate(token)
    const acctsRes = await fetch('https://be.broker.ru/trade-api-bff-operations/api/v1/accounts', {
      // /accounts живёт на сервисе operations (см. BCS_PORTS.operations в bcs/index.js)
      headers: { 'Authorization': `Bearer ${access_token}` }
    })
    if (!acctsRes.ok) {
      const text = await acctsRes.text().catch(() => '')
      return res.status(502).json({
        error: 'bcs_accounts_failed',
        message: `BCS /accounts вернул ${acctsRes.status}: ${text || acctsRes.statusText}`
      })
    }
    const accounts = await acctsRes.json()
    res.json({
      accounts: Array.isArray(accounts) ? accounts.map(a => ({
        id: a.id,
        name: a.name || a.type || null
      })) : []
    })
  } catch (e) {
    res.status(502).json({ error: 'bcs_error', message: e.message })
  }
})

export default router