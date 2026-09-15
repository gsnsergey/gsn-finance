// Импорт банковских выписок: тонкая Express-обёртка над lib/import.js.
//
// Эндпоинты:
//   POST /api/import/alfa/preview   — парсит PDF Альфа-выписки, возвращает
//     операции с предложенными категориями и пометками о существующем
//     импорте (по externalRef). НЕ записывает в БД.
//
//   POST /api/import/alfa-csv/preview — парсит CSV-выписку Альфа-Банка
//     (UTF-8, BOM допустим, разделитель `,`). Счёт резолвится по номеру р/с
//     и/или маске карты; переводы между своими счетами склеиваются в
//     type='transfer'.
//
//   POST /api/import/tochka/preview — парсит CSV-выписку Точка-Банка
//     (UTF-8, BOM допустим, разделитель `;`). Возвращает preview с
//     type='transfer' для переводов собственных средств — UI должен показать
//     для них 2 select'а (источник + получатель).
//
//   POST /api/transactions/import — записывает выбранные операции из превью
//     в transactions с source='import'. Дедуп по externalRef: уже
//     импортированные пропускаются и возвращаются в `skipped`. Для transfer
//     пишет ДВЕ связанные записи с одним externalRef.

import express from 'express'
import db from '../db.js'
import {
  buildAlfaPreview,
  previewAlfaFromPdf,
  previewAlfaCsvFromCsv,
  previewTochkaFromCsv,
  applyImport
} from '../lib/import.js'

const router = express.Router()

// Размер лимита под PDF: Альфа-выписка за месяц с 50-100 операциями обычно
// весит 100-300 KB; 20 MB — запас на годы выписок.
const PDF_LIMIT = '20mb'
// CSV Точки за ~9 месяцев (212 операций) — около 150 KB. 5 MB — большой запас.
const CSV_LIMIT = '5mb'

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
// POST /api/import/alfa-csv/preview
// Body: text/csv (UTF-8, BOM опционален) с CSV-выпиской Альфа-Банка.
//
// Отдельный эндпоинт (не /alfa/preview), потому что PDF и CSV — разные
// форматы с разным Content-Type. UI выбирает endpoint по расширению файла.
// =====================================================================
router.post('/alfa-csv/preview',
  express.text({ type: ['text/csv', 'text/plain'], limit: CSV_LIMIT }),
  (req, res) => {
    const text = typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '')
    if (!text || !text.trim()) {
      return res.status(400).json({
        error: 'csv_required',
        message: 'Тело запроса должно содержать CSV-файл выписки Альфа-Банка (Content-Type: text/csv).'
      })
    }
    try {
      const result = previewAlfaCsvFromCsv(text, db)
      res.json(result)
    } catch (e) {
      // Парсер бросает понятную ошибку, если не хватает колонок в шапке.
      if (/header не содержит/i.test(e.message)) {
        return res.status(400).json({ error: 'csv_format_invalid', message: e.message })
      }
      res.status(500).json({ error: 'csv_parse_failed', message: e.message })
    }
  }
)

// =====================================================================
// POST /api/import/tochka/preview
// Body: text/csv (UTF-8, BOM опционален) с CSV-выпиской Точка-Банка.
// =====================================================================
router.post('/tochka/preview',
  express.text({ type: ['text/csv', 'text/plain'], limit: CSV_LIMIT }),
  (req, res) => {
    const text = typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '')
    if (!text || !text.trim()) {
      return res.status(400).json({
        error: 'csv_required',
        message: 'Тело запроса должно содержать CSV-файл выписки Точка-Банка (Content-Type: text/csv).'
      })
    }
    try {
      const result = previewTochkaFromCsv(text, db)
      res.json(result)
    } catch (e) {
      // Парсер бросает понятную ошибку если не хватает колонок в шапке.
      // Не показываем её как 500 — это пользовательский ввод.
      if (/header не содержит/i.test(e.message)) {
        return res.status(400).json({ error: 'csv_format_invalid', message: e.message })
      }
      res.status(500).json({ error: 'csv_parse_failed', message: e.message })
    }
  }
)

// =====================================================================
// POST /api/transactions/import
// Body: { operations: ImportItem[] }
// ImportItem:
//   { externalRef?, accountId, transferAccountId? (transfer only),
//     type: 'income'|'expense'|'transfer', amount, currency?, categoryId?,
//     date, mcc?, merchantName?, bankSource?: 'alfa'|'tochka' }
// =====================================================================
router.post('/', (req, res) => {
  const body = req.body || {}
  const items = body.operations
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'operations_required', message: 'Body.operations должен быть непустым массивом.' })
  }

  // Пре-валидация. externalRef опционален — для платежей без ID (штрафы ГИБДД,
  // СБП) backend сгенерирует synthetic ключ для дедупа (см. makeSyntheticRef
  // в lib/import.js). accountId/date/type/amount обязательны; для transfer
  // дополнительно требуется transferAccountId.
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.accountId || !it.date || !it.type || typeof it.amount !== 'number') {
      return res.status(400).json({
        error: 'invalid_item',
        index: i,
        message: 'Каждый элемент operations должен содержать accountId, date, type, amount.'
      })
    }
    if (!['income', 'expense', 'transfer'].includes(it.type)) {
      return res.status(400).json({ error: 'invalid_type', index: i, allowed: ['income', 'expense', 'transfer'] })
    }
    if (it.type === 'transfer' && !it.transferAccountId) {
      return res.status(400).json({
        error: 'transfer_account_required',
        index: i,
        message: 'Для операции с type=transfer требуется поле transferAccountId (счёт-получатель).'
      })
    }
  }

  try {
    const result = applyImport(items, db)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: 'import_failed', message: e.message })
  }
})

export default router