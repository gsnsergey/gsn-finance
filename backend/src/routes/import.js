// Импорт банковских выписок: тонкая Express-обёртка над lib/import.js.
//
// Эндпоинты:
//   POST /api/import/alfa/preview — парсит PDF Альфа-выписки, возвращает
//     операции с предложенными категориями и пометками о существующем
//     импорте (по externalRef). НЕ записывает в БД.
//
//   POST /api/transactions/import — записывает выбранные операции из превью
//     в transactions с source='import'. Дедуп по externalRef: уже
//     импортированные пропускаются и возвращаются в `skipped`.

import express from 'express'
import db from '../db.js'
import { buildAlfaPreview, applyAlfaImport, previewAlfaFromPdf } from '../lib/import.js'

const router = express.Router()

// Размер лимита под PDF: Альфа-выписка за месяц с 50-100 операциями обычно
// весит 100-300 KB; 20 MB — запас на годы выписок.
const PDF_LIMIT = '20mb'

// =====================================================================
// POST /api/import/alfa/preview
// Body: application/pdf (Buffer) с PDF-файлом выписки Альфа-Банка.
// =====================================================================
router.post('/alfa/preview', express.raw({ type: 'application/pdf', limit: PDF_LIMIT }), async (req, res) => {
  const buffer = req.body
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'pdf_required', message: 'Тело запроса должно содержать PDF-файл (Content-Type: application/pdf).' })
  }
  try {
    const result = await previewAlfaFromPdf(buffer, db)
    res.json(result)
  } catch (e) {
    res.status(500).json({
      error: 'pdf_parse_failed',
      message: `Не удалось обработать PDF: ${e.message}. Возможно, пакет pdf-parse не установлен (npm install в backend).`
    })
  }
})

// =====================================================================
// POST /api/transactions/import
// Body: { operations: ImportItem[] }
// =====================================================================
router.post('/', (req, res) => {
  const body = req.body || {}
  const items = body.operations
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'operations_required', message: 'Body.operations должен быть непустым массивом.' })
  }

  // Пре-валидация.
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.externalRef || !it.accountId || !it.date || !it.type || typeof it.amount !== 'number') {
      return res.status(400).json({
        error: 'invalid_item',
        index: i,
        message: 'Каждый элемент operations должен содержать externalRef, accountId, date, type, amount.'
      })
    }
    if (!['income', 'expense'].includes(it.type)) {
      return res.status(400).json({ error: 'invalid_type', index: i, allowed: ['income', 'expense'] })
    }
  }

  try {
    const result = applyAlfaImport(items, db)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: 'import_failed', message: e.message })
  }
})

export default router