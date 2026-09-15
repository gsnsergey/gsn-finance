// Бизнес-логика импорта банковских выписок, отделённая от Express-роутера.
//
// `routes/import.js` — тонкая обёртка над этими функциями: парсит PDF/CSV,
// достаёт массив операций, дальше вызывает buildAlfaPreview/buildTochkaPreview
// (preview) или applyImport (запись). Тесты могут вызывать функции напрямую с
// любой better-sqlite3-БД, что делает их детерминированными.
//
// Поддерживаемые банки:
//   - Альфа-Банк: PDF-выписка → parseAlfaStatement
//   - Альфа-Банк: CSV-выписка → parseAlfaCsvStatement (счёт по номеру р/с или
//     маске карты; переводы между своими счетами склеиваются в 'transfer')
//   - Точка-Банк: CSV-выписка → parseTochkaStatement (с типом 'transfer'
//     для переводов собственных средств между своими счетами)

import { createHash } from 'node:crypto'
import { v4 as uuid } from 'uuid'
import { parseAlfaStatement } from './parsers/alfa.js'
import { parseAlfaCsvStatement, OWN_TRANSFER_CATEGORY } from './parsers/alfa-csv.js'
import { parseTochkaStatement } from './parsers/tochka.js'
import { applyRulesToOperations } from './mapping.js'

/**
 * Synthetic externalRef для операций без ID (платежи через Альфа-систему:
 * штрафы ГИБДД, СБП, ЖКХ, налоги). Использует стабильный hash от
 * date + amount + description[:50] — одинаковый ключ для повторного
 * импорта той же операции → дедуп работает даже без оригинального ID.
 *
 * Префикс `gen-` отличает synthetic от настоящих externalRef (CRD_, A…).
 */
function makeSyntheticRef(it) {
  const blob = `${it.date}|${it.amount}|${(it.description || it.merchantName || '').slice(0, 50)}`
  return `gen-${createHash('sha1').update(blob).digest('hex').slice(0, 16)}`
}

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
 * Загружает уже сохранённые операции по externalRef. Нужно, чтобы в превью
 * дубли показывали РЕАЛЬНЫЕ счёт/категорию/вид из БД, а не выглядели
 * «незаполненными» (иначе строка «уже импортирована», но счёт пустой).
 * @returns {Map<string, Array<{accountId, categoryId, type, amount}>>}
 */
function loadExistingByRef(db, refs) {
  const unique = [...new Set(refs.filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = db.prepare(`
    SELECT externalRef, accountId, categoryId, type, amount
      FROM transactions
     WHERE externalRef IN (${unique.map(() => '?').join(',')})
  `).all(...unique)
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.externalRef)) map.set(r.externalRef, [])
    map.get(r.externalRef).push(r)
  }
  return map
}

/**
 * Данные для дубля: у обычной операции — единственная запись, у transfer —
 * две половины (расход = источник, приход = получатель).
 * @returns {{existingAccountId?, existingTransferAccountId?, existingCategoryId?, existingType?}}
 */
function existingFieldsFor(rows, type) {
  if (!rows || !rows.length) return {}
  if (type === 'transfer') {
    const source = rows.find(r => r.amount < 0) || rows[0]
    const target = rows.find(r => r.amount > 0) || null
    return {
      existingAccountId: source ? source.accountId : null,
      existingTransferAccountId: target ? target.accountId : null,
      existingCategoryId: null,
      existingType: 'transfer'
    }
  }
  const row = rows[0]
  return {
    existingAccountId: row.accountId,
    existingCategoryId: row.categoryId || null,
    existingType: row.type
  }
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

  // Дедуп по externalRef. Для дублей сразу тянем счёт/категорию/вид из БД:
  // иначе строка «уже импортирована» показывалась как незаполненная.
  const existingByRef = loadExistingByRef(db, withMapping.map(o => o.externalRef))

  let alreadyImported = 0
  let unresolvedAccount = 0
  const result = withMapping.map(op => {
    const card = cardByMask.get(op.panMask)
    const resolvedAccountId = card ? card.accountId : null
    const existingRows = existingByRef.get(op.externalRef)
    const dup = !!existingRows
    if (dup) alreadyImported++
    // Дубли не считаем «без счёта»: их всё равно не импортируют.
    if (!dup && !resolvedAccountId) unresolvedAccount++
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
      // HOLD-операции (неподтверждённые резервы) — сумма зарезервирована,
      // но ещё не списана. UI подсвечивает их жёлтым и предупреждает.
      confirmed: op.confirmed !== false,
      // Насколько полно парсер распознал блок:
      //   full    — карточная операция с PAN + MCC + merchant
      //   partial — что-то есть, но не всё (например, перевод без MCC)
      //   minimal — только дата + ID + сумма (платёж ГИБДД / СБП / ЖКХ)
      recognitionLevel: op.recognitionLevel || 'minimal',
      resolvedAccountId,
      resolvedAccountName: card ? card.accountName : null,
      suggestedCategoryId: op.suggestedCategoryId,
      matchedRule: op.matchedRule,
      rawSource: op.rawSource || op.description || null,
      alreadyImported: dup,
      ...existingFieldsFor(existingRows, op.type)
    }
  })

  return {
    operations: result,
    totals: { found: result.length, alreadyImported, unresolvedAccount }
  }
}

/**
 * Записывает операции в БД с дедупом по externalRef.
 *
 * Поддерживает 3 типа:
 *   - 'expense'  → amount = -Math.abs(amount), одна запись, баланс ↓
 *   - 'income'   → amount = +Math.abs(amount), одна запись, баланс ↑
 *   - 'transfer' → ДВЕ записи с общим externalRef: −X на accountId
 *                  (источник, баланс ↓), +X на transferAccountId
 *                  (получатель, баланс ↑). Категория для transfer не
 *                  задаётся (категории — для income/expense).
 *
 * Дедуп: если в БД уже есть ЛЮБАЯ запись с таким externalRef, обе записи
 * transfer считаются уже импортированными и пропускаются целиком.
 *
 * @param {Array<ImportItem>} items  см. routes/import.js
 * @param {object} db               better-sqlite3 instance
 * @returns {{created: number, skipped: number, errors: object[], createdIds: string[]}}
 *
 * ImportItem (Альфа-стиль и Точка):
 *   {
 *     externalRef: string,
 *     accountId: string,
 *     transferAccountId?: string,   // только для type='transfer'
 *     type: 'income'|'expense'|'transfer',
 *     amount: number,                // положительные копейки
 *     currency?: 'RUB'|'RUR',
 *     categoryId?: string,
 *     date: 'YYYY-MM-DD',
 *     mcc?: string,
 *     merchantName?: string,
 *     bankSource?: 'alfa'|'tochka'   // влияет на префикс комментария
 *   }
 */
export function applyImport(items, db) {
  const now = new Date().toISOString()
  const findExisting = db.prepare(`SELECT id FROM transactions WHERE externalRef = ? LIMIT 1`)
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
      const ref = it.externalRef || makeSyntheticRef(it)

      // Один findExisting достаточно — для transfer обе записи создаются
      // с одним ref; если хоть одна существует, обе считаются импортированными.
      const existing = findExisting.get(ref)
      if (existing) {
        result.skipped++
        continue
      }

      const isTransfer = it.type === 'transfer'

      // Для transfer нужны 2 счёта: источник (accountId) и получатель
      // (transferAccountId). Оба должны быть валидными и НЕ равны друг другу
      // (самоперевод не имеет смысла).
      if (isTransfer) {
        if (!it.transferAccountId) {
          result.errors.push({ externalRef: ref, reason: 'transfer_account_required' })
          continue
        }
        if (it.transferAccountId === it.accountId) {
          result.errors.push({ externalRef: ref, reason: 'transfer_account_same_as_source' })
          continue
        }
      }

      const account = findAccount.get(it.accountId)
      if (!account) {
        result.errors.push({ externalRef: ref, reason: 'account_not_found_or_archived' })
        continue
      }

      const targetAccount = isTransfer ? findAccount.get(it.transferAccountId) : null
      if (isTransfer && !targetAccount) {
        result.errors.push({ externalRef: ref, reason: 'transfer_account_not_found_or_archived' })
        continue
      }

      // Категории — только для income/expense. Для transfer категория=null.
      if (!isTransfer && it.categoryId) {
        const cat = findCategory.get(it.categoryId)
        if (!cat) {
          result.errors.push({ externalRef: ref, reason: 'category_not_found' })
          continue
        }
      }

      const absAmount = Math.abs(Math.round(it.amount))
      const currency = it.currency || 'RUB'
      const bankPrefix = it.bankSource === 'tochka' ? 'Импорт Точка' : 'Импорт Альфа'

      // Комментарий. transfer — короткий, без категории/MCC (там другая природа).
      let comment
      if (isTransfer) {
        const parts = []
        if (it.merchantName) parts.push(it.merchantName)
        comment = parts.length ? `[${bankPrefix} · перевод] ${parts.join(' / ')}` : `[${bankPrefix} · перевод]`
      } else {
        const parts = []
        if (it.mcc) parts.push(`MCC ${it.mcc}`)
        if (it.merchantName) parts.push(it.merchantName)
        comment = parts.length ? `[${bankPrefix}] ${parts.join(' / ')}` : bankPrefix
      }

      // Знаки суммы по типу:
      //   expense  → −absAmount (списание со счёта, баланс ↓)
      //   income   → +absAmount (поступление на счёт, баланс ↑)
      //   transfer → источник: −absAmount (баланс ↓), получатель: +absAmount (баланс ↑)
      const sign = it.type === 'expense' ? -1 : +1
      const signedSource = sign * absAmount

      try {
        if (isTransfer) {
          // Запись 1: источник (−X). Знак amount отрицательный — для истории и
          // для будущей формулы CURRENT_BALANCE_EXPR, если её расширят.
          // Сейчас balance.js:signedDelta возвращает 0 для transfer, и
          // accounts.balance мы НЕ трогаем (закомно): реальный баланс
          // считается как balance + Σ(income/expense), transfer — бухгалтерская
          // проводка «откуда → куда», она не должна задним числом искажать
          // зафиксированный остаток (balanceAsOf). Если пользователь хочет
          // отразить перемещение в балансе — он сверет счёт через /reconcile.
          const idSource = uuid()
          insert.run(
            idSource, it.accountId, 'transfer', signedSource, currency, null, it.date, comment,
            ref, now, now
          )
          result.created++
          result.createdIds.push(idSource)

          // Запись 2: получатель (+X). Те же ограничения: balance не двигаем.
          const idTarget = uuid()
          insert.run(
            idTarget, it.transferAccountId, 'transfer', absAmount, currency, null, it.date, comment,
            ref, now, now
          )
          result.created++
          result.createdIds.push(idTarget)
        } else {
          const id = uuid()
          insert.run(id, it.accountId, it.type, signedSource, currency, it.categoryId || null, it.date, comment, ref, now, now)
          updateBalance.run(signedSource, now, it.accountId)
          result.created++
          result.createdIds.push(id)
        }
      } catch (e) {
        result.errors.push({ externalRef: ref, reason: e.message })
      }
    }
    return result
  })
  return run()
}

/**
 * Backward-compat алиас: раньше называлась applyAlfaImport. Сейчас единая
 * applyImport для обоих банков (Альфа + Точка).
 */
export const applyAlfaImport = applyImport

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

// =================================================================
// Точка-Банк (CSV).
//
// Автоматический резолв счёта: CSV Точки содержит «Счёт плательщика» и
// «Счёт получателя» — это номера р/с (20 цифр). Если пользователь
// заполнил `accounts.accountNumber` для своих счетов Точки — импорт сам
// сопоставит операцию с accountId. Не нужно выбирать руками.
//
// Логика:
//   income (Входящий)  → resolvedAccountId = счёт получателя (= наш, куда пришли деньги)
//   expense (Исходящий) → resolvedAccountId = счёт плательщика (= наш, откуда ушли)
//   transfer (любое направление) →
//     accountId          = счёт плательщика (тот, с которого ушли деньги)
//     transferAccountId  = счёт получателя (тот, на который пришли)
//     Направление в выписке здесь вторично — это перспектива основного
//     счёта Точки, а не наш признак «откуда/куда».
//
// Если accountNumber из выписки не найден в accounts (bank='tochka') —
// операция остаётся unresolvedAccount и пользователь выбирает счёт в UI.
// =================================================================

/**
 * Резолвит карту «номер счёта (20 цифр) → {id, name}» для счетов Точки.
 * Один запрос на весь импорт — на 212 операций это O(1) БД-вызов.
 *
 * @param {string[]} accountNumbers  уникальные номера из выписки
 * @param {object} db
 * @returns {Map<string, {id: string, name: string}>}
 */
function buildAccountNumberMap(accountNumbers, db) {
  const map = new Map()
  const nums = [...new Set(accountNumbers.filter(Boolean))]
  if (!nums.length) return map
  const placeholders = nums.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, name, accountNumber FROM accounts WHERE bank = ? AND archived = 0 AND accountNumber IN (${placeholders})`
  ).all('tochka', ...nums)
  for (const r of rows) map.set(r.accountNumber, { id: r.id, name: r.name })
  return map
}

/**
 * Собирает preview для Точки-выписки (CSV).
 *
 * @param {Array} operations  результат parseTochkaStatement
 * @param {object} db         better-sqlite3 instance
 * @returns {{operations: object[], totals: {found, alreadyImported, unresolvedAccount, transferCount}}}
 */
export function buildTochkaPreview(operations, db) {
  if (!operations.length) {
    return { operations: [], totals: { found: 0, alreadyImported: 0, unresolvedAccount: 0, transferCount: 0 } }
  }

  // Применяем правила маппинга — сработают только descriptionRegex/merchantName,
  // потому что у Точки нет MCC.
  const withMapping = applyRulesToOperations(operations, null)

  // Авто-резолв: собираем все уникальные номера счетов из выписки, делаем
  // один запрос в БД.
  const accountNumbers = []
  for (const op of withMapping) {
    if (op.payerAccount) accountNumbers.push(op.payerAccount)
    if (op.payeeAccount) accountNumbers.push(op.payeeAccount)
  }
  const accountByNumber = buildAccountNumberMap(accountNumbers, db)

  // Дедуп по externalRef. Для дублей тянем счёт/категорию/вид из БД (см.
  // loadExistingByRef) — иначе строка выглядит незаполненной.
  const existingByRef = loadExistingByRef(db, withMapping.map(o => o.externalRef))

  let alreadyImported = 0
  let unresolvedAccount = 0
  let transferCount = 0
  const result = withMapping.map(op => {
    const existingRows = existingByRef.get(op.externalRef)
    const dup = !!existingRows
    if (dup) alreadyImported++

    // Резолв по номеру счёта из выписки.
    let resolvedAccountId = null
    let resolvedAccountName = null
    let resolvedTransferAccountId = null
    let resolvedTransferAccountName = null

    const payerMatch = op.payerAccount ? accountByNumber.get(op.payerAccount) : null
    const payeeMatch = op.payeeAccount ? accountByNumber.get(op.payeeAccount) : null

    if (op.type === 'transfer') {
      // transfer: деньги ушли с payerAccount (источник, баланс ↓) на
      // payeeAccount (получатель, баланс ↑). Направление в выписке
      // вторично.
      if (payerMatch) {
        resolvedAccountId = payerMatch.id
        resolvedAccountName = payerMatch.name
      }
      if (payeeMatch) {
        resolvedTransferAccountId = payeeMatch.id
        resolvedTransferAccountName = payeeMatch.name
      }
    } else if (op.type === 'income') {
      // входящая: деньги пришли НА наш счёт = payeeAccount
      if (payeeMatch) {
        resolvedAccountId = payeeMatch.id
        resolvedAccountName = payeeMatch.name
      }
    } else if (op.type === 'expense') {
      // исходящая: деньги ушли С нашего счёта = payerAccount
      if (payerMatch) {
        resolvedAccountId = payerMatch.id
        resolvedAccountName = payerMatch.name
      }
    }

    // unresolved — это когда ни источник, ни (для transfer) получатель
    // не зарезолвились. Для transfer оба обязательны; для income/expense — только источник.
    // Дубли не считаем: их не импортируют.
    if (!dup) {
      if (op.type === 'transfer') {
        if (!resolvedAccountId || !resolvedTransferAccountId) unresolvedAccount++
      } else {
        if (!resolvedAccountId) unresolvedAccount++
      }
    }

    if (op.type === 'transfer') transferCount++

    return {
      externalRef: op.externalRef,
      date: op.date,
      originalDate: op.originalDate,
      type: op.type,
      amount: op.amount,                   // для transfer всегда положительный
      currency: op.currency,
      panMask: op.panMask,
      mcc: op.mcc,
      merchantName: op.merchantName,
      terminalId: op.terminalId,
      country: op.country,
      city: op.city,
      description: op.description,
      // Подтверждение из выписки — всегда true (HOLD-режима у Точки нет).
      confirmed: op.confirmed !== false,
      recognitionLevel: op.recognitionLevel || 'minimal',
      // Авто-резолв по номеру счёта. UI может переопределить через select.
      resolvedAccountId,
      resolvedAccountName,
      // Для transfer нужен второй счёт. По умолчанию null — UI предложит выбор.
      transferAccountId: op.type === 'transfer' ? resolvedTransferAccountId : undefined,
      transferAccountName: op.type === 'transfer' ? resolvedTransferAccountName : undefined,
      // Контекст для UI: payerAccount/payeeAccount — пользователь видит откуда/куда.
      payerName: op.payerName || null,
      payeeName: op.payeeName || null,
      payerAccount: op.payerAccount || null,
      payeeAccount: op.payeeAccount || null,
      payerInn: op.payerInn || null,
      payeeInn: op.payeeInn || null,
      purposeKind: op.purposeKind || null,
      suggestedCategoryId: op.suggestedCategoryId,
      matchedRule: op.matchedRule,
      rawSource: op.rawSource || null,
      alreadyImported: dup,
      ...existingFieldsFor(existingRows, op.type)
    }
  })

  return {
    operations: result,
    totals: { found: result.length, alreadyImported, unresolvedAccount, transferCount }
  }
}

/**
 * Полный цикл preview для Точки-выписки: CSV text → preview JSON.
 * @param {string} csvText  UTF-8 текст CSV (с BOM или без)
 * @param {object} db       better-sqlite3 instance
 * @returns {{operations, totals}}
 */
export function previewTochkaFromCsv(csvText, db) {
  const ops = parseTochkaStatement(csvText || '')
  return buildTochkaPreview(ops, db)
}

// =================================================================
// Альфа-Банк (CSV-выписка).
//
// Формат CSV отличается от PDF: есть готовые колонки accountNumber/cardNumber,
// поэтому счёт резолвится сразу по двум ключам:
//   1. accountNumber (20 цифр) → accounts.accountNumber (bank='alfa')
//   2. cardNumber (маска `220015******4795` → `220015++++++4795`) → account_cards
//
// Категории: Alfa отдаёт свою категорию (`bankCategory`). Если правило
// import_rules (MCC / merchantName / regex) не сработало, но название
// категории Альфы точно совпадает с категорией в БД — подставляем её.
// Это не заменяет правила, а даёт полезный дефолт («Продукты» → «Продукты»).
//
// Переводы между своими счетами: Альфа пишет две строки с одной датой и
// суммой — «Списание» на счёте-источнике и «Пополнение» на счёте-получателе
// (category = «Между своими счетами»). Склеиваем их в одну операцию
// type='transfer', иначе балансы и дашборд раздуваются на обе стороны.
// =================================================================

/**
 * Резолвит счёт по номеру р/с и/или маске карты для счетов Альфы.
 * @param {Array} operations результат parseAlfaCsvStatement
 * @param {object} db
 * @returns {{byNumber: Map, byMask: Map}}
 */
function buildAlfaAccountMaps(operations, db) {
  const byNumber = new Map()
  const byMask = new Map()

  const numbers = [...new Set(operations.map(o => o.accountNumber).filter(Boolean))]
  if (numbers.length) {
    const rows = db.prepare(
      `SELECT id, name, accountNumber FROM accounts
        WHERE bank = 'alfa' AND archived = 0 AND accountNumber IN (${numbers.map(() => '?').join(',')})`
    ).all(...numbers)
    for (const r of rows) byNumber.set(r.accountNumber, { id: r.id, name: r.name })
  }

  const masks = [...new Set(operations.map(o => o.panMask).filter(Boolean))]
  if (masks.length) {
    const rows = db.prepare(
      `SELECT ac.panMask, ac.accountId, a.name
         FROM account_cards ac JOIN accounts a ON a.id = ac.accountId
        WHERE a.archived = 0 AND ac.panMask IN (${masks.map(() => '?').join(',')})`
    ).all(...masks)
    for (const r of rows) byMask.set(r.panMask, { id: r.accountId, name: r.name })
  }

  return { byNumber, byMask }
}

function normalizeCategoryName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Синонимы: категория банка → название нашей категории. Нужны там, где банк
 * называет категорию иначе и совпадения по имени/вхождению не хватает.
 * Ключи — уже нормализованные названия (normalizeCategoryName). Список
 * небольшой и расширяемый: сюда попадает только реально встречающееся.
 */
const ALFA_CATEGORY_ALIASES = {
  'супермаркеты': 'Продукты',
  'коммунальные платежи': 'Коммуналка'
}

/**
 * Карта «название категории (lowercase) → список категорий» — дефолтная
 * подстановка категории банка из выписки, когда import_rules не сработали.
 * Список, а не один id: имена повторяются у расходов и доходов («Прочее»),
 * и категорию нужно выбирать по типу операции.
 */
function loadCategoryNameMap(db) {
  const rows = db.prepare(`SELECT id, name, type FROM categories WHERE archived = 0`).all()
  const map = new Map()
  for (const r of rows) {
    const key = normalizeCategoryName(r.name)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ id: r.id, name: r.name, type: r.type })
  }
  return map
}

function resolveAlfaAccount(op, maps) {
  if (op.accountNumber) {
    const byNumber = maps.byNumber.get(op.accountNumber)
    if (byNumber) return byNumber
  }
  if (op.panMask) {
    const byMask = maps.byMask.get(op.panMask)
    if (byMask) return byMask
  }
  return null
}

/**
 * Категория по категории банка из выписки Альфы.
 *   1. Явное правило (import_rules) — всегда приоритетнее.
 *   2. Точное совпадение имени с категорией в БД.
 *   3. Явный синоним из ALFA_CATEGORY_ALIASES (банк называет иначе).
 *   4. Имя категории БД входит в категорию банка: «Связь» ⊂ «Связь, интернет
 *      и ТВ» — берём самое длинное (самое специфичное) совпадение.
 * Внутри имени предпочитаем категорию того же типа, что операция (расход/доход):
 * «Прочее» есть в обоих наборах. У нечёткого (по вхождению) совпадения тип
 * обязателен — иначе расход получил бы доходную категорию («Переводы» →
 * «Перевод»).
 */
function alfaSuggestedCategory(op, catByName) {
  if (op.suggestedCategoryId) return op.suggestedCategoryId
  const bank = normalizeCategoryName(op.bankCategory)
  if (!bank) return null
  const pick = (list, allowOtherType) => {
    if (!list || !list.length) return null
    const sameType = list.find(c => c.type === op.type)
    if (sameType) return sameType.id
    return allowOtherType ? list[0].id : null
  }
  const exact = catByName.get(bank)
  if (exact) return pick(exact, true)
  const alias = ALFA_CATEGORY_ALIASES[bank]
  if (alias) {
    const id = pick(catByName.get(normalizeCategoryName(alias)), true)
    if (id) return id
  }
  let best = null
  for (const [key, list] of catByName) {
    if (key.length < 3 || key === bank) continue
    if (!bank.includes(key)) continue
    if (!best || key.length > best.key.length) best = { key, list }
  }
  return best ? pick(best.list, false) : null
}

function toAlfaPreviewEntry(op, account, catByName, order) {
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
    confirmed: op.confirmed !== false,
    recognitionLevel: op.recognitionLevel || 'minimal',
    resolvedAccountId: account ? account.id : null,
    resolvedAccountName: account ? account.name : null,
    bankCategory: op.bankCategory || null,
    status: op.status || null,
    suggestedCategoryId: alfaSuggestedCategory(op, catByName),
    matchedRule: op.matchedRule,
    // Исходные данные строки выписки (UI показывает по кнопке).
    rawSource: op.rawSource || null,
    _order: order
  }
}

function toAlfaTransferEntry(expenseOp, incomeOp, maps, order) {
  const source = resolveAlfaAccount(expenseOp, maps)
  const target = resolveAlfaAccount(incomeOp, maps)

  // Тот же счёт с обеих сторон — это не перевод между своими счетами.
  // Отдаём обе строки как обычные операции, чтобы не порождать
  // transfer_account_same_as_source при записи.
  if (source && target && source.id === target.id) return null

  const amount = Math.abs(expenseOp.amount)
  const hash = createHash('sha1')
    .update([expenseOp.date, amount, expenseOp.accountNumber || '', incomeOp.accountNumber || ''].join('|'))
    .digest('hex').slice(0, 16)

  return {
    externalRef: `alfacsv-transfer-${hash}`,
    date: expenseOp.date,
    originalDate: expenseOp.originalDate,
    type: 'transfer',
    amount,
    currency: expenseOp.currency,
    panMask: null,
    mcc: null,
    merchantName: OWN_TRANSFER_CATEGORY,
    terminalId: null,
    country: null,
    city: null,
    description: `${OWN_TRANSFER_CATEGORY}: ${expenseOp.accountNumber || '?'} → ${incomeOp.accountNumber || '?'}`,
    confirmed: expenseOp.confirmed !== false && incomeOp.confirmed !== false,
    recognitionLevel: 'minimal',
    resolvedAccountId: source ? source.id : null,
    resolvedAccountName: source ? source.name : null,
    transferAccountId: target ? target.id : null,
    transferAccountName: target ? target.name : null,
    payerAccount: expenseOp.accountNumber || null,
    payeeAccount: incomeOp.accountNumber || null,
    bankCategory: OWN_TRANSFER_CATEGORY,
    status: expenseOp.status || null,
    suggestedCategoryId: null,
    matchedRule: null,
    // Обе половины перевода: их исходные строки из файла.
    rawSource: [expenseOp.rawSource, incomeOp.rawSource].filter(Boolean).join('\n') || null,
    _order: order
  }
}

/**
 * Собирает preview для CSV-выписки Альфа-Банка.
 *
 * @param {Array} operations  результат parseAlfaCsvStatement
 * @param {object} db         better-sqlite3 instance
 * @returns {{operations: object[], totals: {found, alreadyImported, unresolvedAccount, transferCount}}}
 */
export function buildAlfaCsvPreview(operations, db) {
  if (!operations.length) {
    return { operations: [], totals: { found: 0, alreadyImported: 0, unresolvedAccount: 0, transferCount: 0 } }
  }

  const withMapping = applyRulesToOperations(operations, null)
  const maps = buildAlfaAccountMaps(withMapping, db)
  const catByName = loadCategoryNameMap(db)

  // Делим строки на обычные и «свои переводы», группируя переводы по
  // дате+сумме: внутри группы Списание = источник, Пополнение = получатель.
  const ownGroups = new Map()
  const entries = []
  withMapping.forEach((op, idx) => {
    if (op.isOwnTransfer && (op.type === 'expense' || op.type === 'income')) {
      // Ключ — дата + МОДУЛЬ суммы: у Списания сумма отрицательная,
      // у Пополнения положительная, но это две половины одного перевода.
      const key = `${op.date}|${Math.abs(op.amount)}`
      if (!ownGroups.has(key)) ownGroups.set(key, { expenses: [], incomes: [] })
      ownGroups.get(key)[op.type === 'expense' ? 'expenses' : 'incomes'].push({ op, idx })
      return
    }
    entries.push(toAlfaPreviewEntry(op, resolveAlfaAccount(op, maps), catByName, idx))
  })

  let transferCount = 0
  for (const group of ownGroups.values()) {
    const pairs = Math.min(group.expenses.length, group.incomes.length)
    for (let i = 0; i < pairs; i++) {
      const { op: expenseOp, idx } = group.expenses[i]
      const { op: incomeOp } = group.incomes[i]
      const entry = toAlfaTransferEntry(expenseOp, incomeOp, maps, idx)
      if (entry) {
        entries.push(entry)
      } else {
        // Самоперевод — оставляем двумя обычными строками.
        entries.push(toAlfaPreviewEntry(expenseOp, resolveAlfaAccount(expenseOp, maps), catByName, idx))
        entries.push(toAlfaPreviewEntry(incomeOp, resolveAlfaAccount(incomeOp, maps), catByName, group.incomes[i].idx))
      }
    }
    // Непарные остатки (например, вторая половина не попала в выписку)
    // сохраняем как обычные операции — терять данные нельзя.
    for (let i = pairs; i < group.expenses.length; i++) {
      const { op, idx } = group.expenses[i]
      entries.push(toAlfaPreviewEntry(op, resolveAlfaAccount(op, maps), catByName, idx))
    }
    for (let i = pairs; i < group.incomes.length; i++) {
      const { op, idx } = group.incomes[i]
      entries.push(toAlfaPreviewEntry(op, resolveAlfaAccount(op, maps), catByName, idx))
    }
  }

  // Восстанавливаем порядок строк исходного файла.
  entries.sort((a, b) => a._order - b._order)

  // Дедуп по externalRef + данные уже сохранённых операций (для дублей).
  const existingByRef = loadExistingByRef(db, entries.map(e => e.externalRef))

  let alreadyImported = 0
  let unresolvedAccount = 0
  for (const e of entries) {
    const existingRows = existingByRef.get(e.externalRef)
    const dup = !!existingRows
    if (dup) alreadyImported++
    if (e.type === 'transfer') {
      transferCount++
      // Дубли не считаем «без счёта»: их не импортируют.
      if (!dup && (!e.resolvedAccountId || !e.transferAccountId)) unresolvedAccount++
    } else if (!dup && !e.resolvedAccountId) {
      unresolvedAccount++
    }
    e.alreadyImported = dup
    Object.assign(e, existingFieldsFor(existingRows, e.type))
  }

  const result = entries.map(({ _order, ...e }) => e)
  return {
    operations: result,
    totals: { found: result.length, alreadyImported, unresolvedAccount, transferCount }
  }
}

/**
 * Полный цикл preview для CSV-выписки Альфы: CSV text → preview JSON.
 * @param {string} csvText  UTF-8 текст CSV (с BOM или без)
 * @param {object} db       better-sqlite3 instance
 * @returns {{operations, totals}}
 */
export function previewAlfaCsvFromCsv(csvText, db) {
  const ops = parseAlfaCsvStatement(csvText || '')
  return buildAlfaCsvPreview(ops, db)
}