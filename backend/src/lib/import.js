// Бизнес-логика импорта банковских выписок, отделённая от Express-роутера.
//
// `routes/import.js` — тонкая обёртка над этими функциями: парсит PDF,
// достаёт массив операций, дальше вызывает buildAlfaPreview (preview) или
// applyAlfaImport (запись). Тесты могут вызывать функции напрямую с любой
// better-sqlite3-БД, что делает их детерминированными.

import { v4 as uuid } from 'uuid'
import { parseAlfaStatement } from './parsers/alfa.js'
import { applyRulesToOperations } from './mapping.js'

/**
 * Резолвит маски карт в счета через account_cards.
 * @returns {Map<string, {accountId: string, accountName: string}>}
 */
function resolveAccountCards(db, panMasks) {
  if (!panMasks.length) return new Map()
  const rows = db.prepare(`
    SELECT ac.panMask, ac.accountId, a.name AS accountName
      FROM account_cards ac JOIN accounts a ON a.id = ac.accountId
     WHERE ac.panMask IN (${panMasks.map(() => '?').join(',')})
       AND a.archived = 0
  `).all(...panMasks)
  return new Map(rows.map(r => [r.panMask, { accountId: r.accountId, accountName: r.accountName }]))
}

/**
 * Собирает preview для UI: операции + suggested категория + дедуп-метки.
 *
 * @param {Array} operations   результат parseAlfaStatement
 * @param {object} db          better-sqlite3 instance (default: основной)
 * @returns {{operations: object[], totals: {found, alreadyImported, unresolvedAccount}}}
 */
export function buildAlfaPreview(operations, db) {
  if (!operations.length) {
    return { operations: [], totals: { found: 0, alreadyImported: 0, unresolvedAccount: 0 } }
  }

  // Резолвим panMask → счёт.
  const panMasks = [...new Set(operations.map(o => o.panMask))]
  const cardByMask = resolveAccountCards(db, panMasks)

  // Применяем правила маппинга (глобальные + счёт-специфичные — loadRules знает accountId,
  // но на этапе preview мы не знаем счёт; берём глобальные. UI потом может переопределить).
  const withMapping = applyRulesToOperations(operations, null)

  // Дедуп по externalRef.
  const externalRefs = operations.map(o => o.externalRef)
  const existing = externalRefs.length
    ? db.prepare(`SELECT externalRef, accountId FROM transactions WHERE externalRef IN (${externalRefs.map(() => '?').join(',')})`).all(...externalRefs)
    : []
  const existingByRef = new Map(existing.map(r => [r.externalRef, r.accountId]))

  let alreadyImported = 0
  let unresolvedAccount = 0
  const result = withMapping.map(op => {
    const card = cardByMask.get(op.panMask)
    const resolvedAccountId = card ? card.accountId : null
    const dup = existingByRef.has(op.externalRef)
    if (dup) alreadyImported++
    if (!resolvedAccountId) unresolvedAccount++
    return {
      externalRef: op.externalRef,
      date: op.date,
      originalDate: op.originalDate,
      type: op.type,
      amount: op.amount,
      currency: op.currency,
      panMask: op.panMask,
      mcc: op.mcc,
      merchantName: op.merchantName,
      terminalId: op.terminalId,
      country: op.country,
      city: op.city,
      description: op.description,
      resolvedAccountId,
      resolvedAccountName: card ? card.accountName : null,
      suggestedCategoryId: op.suggestedCategoryId,
      matchedRule: op.matchedRule,
      alreadyImported: dup,
      existingAccountId: existingByRef.get(op.externalRef) || null
    }
  })

  return {
    operations: result,
    totals: { found: result.length, alreadyImported, unresolvedAccount }
  }
}

/**
 * Записывает операции в БД с дедупом по externalRef.
 * @param {Array} items  см. routes/import.js — ImportItem
 * @param {object} db    better-sqlite3 instance (default: основной)
 * @returns {{created: number, skipped: number, errors: object[], createdIds: string[]}}
 */
export function applyAlfaImport(items, db) {
  const now = new Date().toISOString()
  const findExisting = db.prepare(`SELECT id, accountId FROM transactions WHERE externalRef = ? LIMIT 1`)
  const insert = db.prepare(`
    INSERT INTO transactions
      (id, accountId, type, amount, currency, categoryId, date, comment, source, externalRef, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)
  `)
  const updateBalance = db.prepare(`UPDATE accounts SET balance = balance + ?, updatedAt = ? WHERE id = ?`)
  const findAccount = db.prepare(`SELECT id FROM accounts WHERE id = ? AND archived = 0`)
  const findCategory = db.prepare(`SELECT id FROM categories WHERE id = ?`)

  const run = db.transaction(() => {
    const result = { created: 0, skipped: 0, errors: [], createdIds: [] }
    for (const it of items) {
      const existing = findExisting.get(it.externalRef)
      if (existing) {
        result.skipped++
        continue
      }
      const account = findAccount.get(it.accountId)
      if (!account) {
        result.errors.push({ externalRef: it.externalRef, reason: 'account_not_found_or_archived' })
        continue
      }
      if (it.categoryId) {
        const cat = findCategory.get(it.categoryId)
        if (!cat) {
          result.errors.push({ externalRef: it.externalRef, reason: 'category_not_found' })
          continue
        }
      }
      // Нормализуем знак: expense → отрицательные копейки, income → положительные.
      const amount = it.type === 'expense'
        ? -Math.abs(Math.round(it.amount))
        : Math.abs(Math.round(it.amount))

      const commentParts = []
      if (it.mcc) commentParts.push(`MCC ${it.mcc}`)
      if (it.merchantName) commentParts.push(it.merchantName)
      const comment = commentParts.length ? `[Импорт Альфа] ${commentParts.join(' / ')}` : 'Импорт Альфа'

      const id = uuid()
      const currency = it.currency || 'RUB'
      try {
        insert.run(id, it.accountId, it.type, amount, currency, it.categoryId || null, it.date, comment, it.externalRef, now, now)
        // Обновляем баланс: для expense уменьшаем (amount < 0), для income увеличиваем.
        updateBalance.run(amount, now, it.accountId)
        result.created++
        result.createdIds.push(id)
      } catch (e) {
        result.errors.push({ externalRef: it.externalRef, reason: e.message })
      }
    }
    return result
  })
  return run()
}

/**
 * Полный цикл preview для Альфа-выписки: PDF buffer → preview JSON.
 * @param {Buffer} pdfBuffer
 * @param {object} db  better-sqlite3 instance
 * @returns {Promise<{operations, totals}>}
 */
export async function previewAlfaFromPdf(pdfBuffer, db) {
  // pdf-parse v2: класс PDFParse. Ленивый импорт — основной сервер не должен
  // падать на старте, если pdf-parse не установлен.
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: pdfBuffer })
  const result = await parser.getText()
  const ops = parseAlfaStatement(result.text || '')
  return buildAlfaPreview(ops, db)
}