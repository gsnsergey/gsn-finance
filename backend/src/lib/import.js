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
import { applyRulesToOperations, applyRulesToResolvedOperations } from './mapping.js'
import { isFixed, signedDelta } from '../balance.js'

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
 * Старый ключ Точки → алиас для поиска уже импортированных операций.
 *
 * До этого ключ был `tchk-doc-{Номер документа}` — не уникальный между счетами
 * (и потому давал ложные дубли). Теперь ключ Точки включает счёт и дату
 * (`tchk-{account}-{yyyymmdd}-doc-{N}`), но в БД остались строки со старым
 * ключом: при дедупе их надо находить по прежнему виду, иначе повторный импорт
 * старой выписки создаст дубликаты.
 *
 * @returns {string|null} legacy-ключ либо null, если ref не в новом формате
 */
function legacyExternalRef(ref) {
  const m = /^tchk-([^-]+)-(\d{8})-doc-(.+)$/.exec(ref || '')
  return m ? `tchk-doc-${m[3]}` : null
}

/**
 * Загружает уже сохранённые операции по externalRef. Нужно, чтобы в превью
 * дубли показывали РЕАЛЬНЫЕ счёт/категорию/вид из БД, а не выглядели
 * «незаполненными» (иначе строка «уже импортирована», но счёт пустой).
 *
 * Помимо нового ключа запрашиваем и legacy-алиас (tchk-doc-…) — строки,
 * импортированные до смены формата ключа Точки.
 *
 * @returns {Map<string, Array<{accountId, categoryId, type, amount, date, transferDirection}>>}
 */
function loadExistingByRef(db, refs) {
  const unique = new Set()
  for (const ref of refs) {
    if (!ref) continue
    unique.add(ref)
    const legacy = legacyExternalRef(ref)
    if (legacy) unique.add(legacy)
  }
  if (!unique.size) return new Map()
  const list = [...unique]
  const rows = db.prepare(`
    SELECT externalRef, accountId, categoryId, type, amount, date, transferDirection
      FROM transactions
     WHERE externalRef IN (${list.map(() => '?').join(',')})
     ORDER BY rowid
  `).all(...list)
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.externalRef)) map.set(r.externalRef, [])
    map.get(r.externalRef).push(r)
  }
  return map
}

/** Строки, сохранённые по этому ref: сначала новый ключ, затем legacy-алиас. */
function existingRowsFor(existingByRef, ref) {
  const direct = existingByRef.get(ref)
  if (direct) return direct
  const legacy = legacyExternalRef(ref)
  return legacy ? existingByRef.get(legacy) : undefined
}

/**
 * Подтверждает дубль по СОДЕРЖИМОМУ, а не только по externalRef.
 *
 * Совпадения одного ключа мало: «Номер документа» Точки не уникален (см.
 * legacyExternalRef), поэтому ref может принадлежать чужой операции. Дублем
 * считаем строку, у которой совпали дата, сумма и (когда счёт известен) счёт.
 * Иначе новая операция молча помечалась «уже в БД», хотя её в базе нет.
 *
 * @returns {Array|null} строки-дубли (для existingFieldsFor) либо null
 */
function matchExisting(rows, op) {
  if (!rows || !rows.length) return null
  const amount = Math.abs(op.amount)
  const byContent = rows.filter(r => r.date === op.date && r.amount === amount)
  if (!byContent.length) return null

  if (op.type === 'transfer') {
    const src = op.resolvedAccountId || null
    const dst = op.transferAccountId || null
    const out = byContent.find(r => r.transferDirection === 'out' && (!src || r.accountId === src))
    const inc = byContent.find(r => r.transferDirection === 'in' && (!dst || r.accountId === dst) && r !== out)
    if (out && inc) return [out, inc]
    // Строки до миграции 019 — transferDirection пустой: различаем ноги по счёту.
    const a = src ? byContent.find(r => r.accountId === src) : null
    const b = dst ? byContent.find(r => r.accountId === dst && r !== a) : null
    if (a && b) return [a, b]
    return null
  }

  if (op.resolvedAccountId) {
    const row = byContent.find(r => r.accountId === op.resolvedAccountId)
    return row ? [row] : null
  }
  // Счёт не зарезолвлен: ref+дата+сумма совпали — считаем дублем. Для CSV
  // Альфы ref уже включает номер счёта, для Точки это редкий случай.
  return [byContent[0]]
}

/**
 * Данные для дубля: у обычной операции — единственная запись, у transfer —
 * две половины (out = источник, in = получатель).
 *
 * Направление берём из transferDirection; для строк, импортированных до
 * миграции 019, колонка пустая — тогда fallback на порядок rowid: applyImport
 * вставляет источник первым, поэтому первая строка группы — источник.
 * @returns {{existingAccountId?, existingTransferAccountId?, existingCategoryId?, existingType?}}
 */
function existingFieldsFor(rows, type) {
  if (!rows || !rows.length) return {}
  if (type === 'transfer') {
    const source = rows.find(r => r.transferDirection === 'out') || rows[0]
    const target = rows.find(r => r.transferDirection === 'in')
      || rows.find(r => r !== source)
      || null
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
    const existingRows = matchExisting(existingRowsFor(existingByRef, op.externalRef), {
      date: op.date,
      amount: op.amount,
      type: op.type,
      resolvedAccountId,
      transferAccountId: null
    })
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

  // Счёт-специфичные правила учитываем ПОСЛЕ резолва счёта: до него мы не знаем,
  // к какому счёту относится операция, а правила бывают привязаны к счёту.
  return {
    operations: applyRulesToResolvedOperations(result),
    totals: { found: result.length, alreadyImported, unresolvedAccount }
  }
}

/**
 * Записывает операции в БД с дедупом по externalRef.
 *
 * Поддерживает 3 типа:
 *   - 'expense'  → amount = +absAmount (положительный), баланс ↓ (если счёт не зафиксирован)
 *   - 'income'   → amount = +absAmount, баланс ↑ (если счёт не зафиксирован)
 *   - 'transfer' → ДВЕ записи с общим externalRef, обе amount = +absAmount:
 *                  источник (accountId, transferDirection='out', баланс ↓)
 *                  и получатель (transferAccountId, transferDirection='in',
 *                  баланс ↑) — только у НЕфиксированных счетов.
 *                  Категория для transfer не задаётся (категории — для income/expense).
 *
 * Инвариант amount: `transactions.amount` ВСЕГДА положителен (>= 0), знак
 * операции берётся из `type` и (для transfer) `transferDirection`
 * (см. balance.js:signedDelta / CURRENT_BALANCE_EXPR).
 * Парсеры отдают знак по-разному — нормализуем Math.abs здесь.
 *
 * Зафиксированный остаток: если у счёта есть balanceAsOf (isFixed), баланс НЕ
 * трогаем инкрементом — balance там снимок на дату фиксации, а движения после
 * неё учитываются формулами currentBalanceOf/CURRENT_BALANCE_EXPR. Остальные
 * пути (routes/transactions.js) делают так же.
 *
 * Дедуп: запись пропускается, если в БД уже есть операция с тем же externalRef
 * И совпадающими датой/суммой/счётом (matchExisting). Одного ref недостаточно:
 * «Номер документа» Точки не уникален между счетами. Для transfer проверяются
 * обе ноги — источник и получатель.
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
 *     bankSource?: 'alfa'|'tochka',  // влияет на префикс комментария
 *     userComment?: string,          // примечание пользователя из превью
 *     rawSource?: string             // оригинальная строка выписки
 *   }
 */
export function applyImport(items, db) {
  const now = new Date().toISOString()
  // Ищем и по новому ключу, и по legacy-алиасу Точки (tchk-doc-…) — строки,
  // импортированные до смены формата ключа. Совпадение ref ещё не дубль:
  // matchExisting сверяет дату/сумму/счёт.
  const findExisting = db.prepare(`
    SELECT id, accountId, type, amount, date, transferDirection
      FROM transactions WHERE externalRef IN (?, ?)
  `)
  const insert = db.prepare(`
    INSERT INTO transactions
      (id, accountId, type, amount, currency, categoryId, date, comment, source, externalRef, rawSource, transferDirection, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?)
  `)
  const updateBalance = db.prepare(`UPDATE accounts SET balance = balance + ?, updatedAt = ? WHERE id = ?`)
  // balance/balanceAsOf нужны, чтобы отличить счёт с фиксацией (isFixed):
  // у такого счёта balance — снимок на дату, инкремент запрещён.
  const findAccount = db.prepare(`SELECT id, balance, balanceAsOf FROM accounts WHERE id = ? AND archived = 0`)
  const findCategory = db.prepare(`SELECT id FROM categories WHERE id = ?`)

  const run = db.transaction(() => {
    const result = { created: 0, skipped: 0, errors: [], createdIds: [] }

    for (const it of items) {
      const ref = it.externalRef || makeSyntheticRef(it)

      // Дубль подтверждаем по содержимому: один и тот же ref (напр. «Номер
      // документа» Точки) бывает у разных операций. Для transfer обе ноги
      // создаются с одним ref; проверяем источник и получателя.
      const existing = matchExisting(findExisting.all(ref, legacyExternalRef(ref) || ''), {
        date: it.date,
        amount: it.amount,
        type: it.type,
        resolvedAccountId: it.accountId,
        transferAccountId: it.transferAccountId
      })
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

      // Знак операции берётся из type, а amount хранится положительным
      // (инвариант всего остального кода). Парсеры отдают разный знак, поэтому
      // нормализуем модуль; влияние на баланс считает signedDelta.
      const absAmount = Math.abs(Math.round(it.amount))
      const delta = signedDelta(it.type, absAmount)
      const currency = it.currency || 'RUB'
      const bankPrefix = it.bankSource === 'tochka' ? 'Импорт Точка' : 'Импорт Альфа'
      // Комментарий. transfer — короткий, без категории/MCC (там другая природа).
      let autoComment
      if (isTransfer) {
        const parts = []
        if (it.merchantName) parts.push(it.merchantName)
        autoComment = parts.length ? `[${bankPrefix} · перевод] ${parts.join(' / ')}` : `[${bankPrefix} · перевод]`
      } else {
        const parts = []
        if (it.mcc) parts.push(`MCC ${it.mcc}`)
        if (it.merchantName) parts.push(it.merchantName)
        autoComment = parts.length ? `[${bankPrefix}] ${parts.join(' / ')}` : bankPrefix
      }
      // Примечание пользователя (введено в превью) идёт первым и отделяется
      // разделителем от авто-комментария банка — обе части сохраняем, чтобы
      // не терять ни своё пояснение, ни разбор выписки. Только trim: пустое
      // или пробельное примечание не должно давать « · » без левой части.
      const userComment = String(it.userComment || '').trim()
      const comment = userComment ? `${userComment} · ${autoComment}` : autoComment
      // Оригинальная строка выписки — одинаковая для обеих ног transfer.
      const rawSource = it.rawSource ?? null

      try {
        if (isTransfer) {
          // Обе ноги хранятся положительными (amount = +absAmount) — знак
          // операции задаёт transferDirection ('out' — источник, 'in' —
          // получатель), а не amount. transferDirection пишется в БД, чтобы
          // формулы баланса (signedDelta/CURRENT_BALANCE_EXPR) могли посчитать
          // перевод и после импорта.
          const idSource = uuid()
          insert.run(
            idSource, it.accountId, 'transfer', absAmount, currency, null, it.date, comment,
            ref, rawSource, 'out', now, now
          )
          result.created++
          result.createdIds.push(idSource)

          // Запись 2: получатель.
          const idTarget = uuid()
          insert.run(
            idTarget, it.transferAccountId, 'transfer', absAmount, currency, null, it.date, comment,
            ref, rawSource, 'in', now, now
          )
          result.created++
          result.createdIds.push(idTarget)

          // У нефиксированного источника balance -= abs, у нефиксированного
          // получателя += abs. У счёта с фиксацией balance — снимок на
          // balanceAsOf, движения после него учитывают формулы
          // currentBalanceOf/CURRENT_BALANCE_EXPR, поэтому инкремент запрещён.
          if (!isFixed(account)) updateBalance.run(-absAmount, now, it.accountId)
          if (!isFixed(targetAccount)) updateBalance.run(absAmount, now, it.transferAccountId)
        } else {
          const id = uuid()
          insert.run(id, it.accountId, it.type, absAmount, currency, it.categoryId || null, it.date, comment, ref, rawSource, null, now, now)
          // У счёта с фиксацией balance — снимок на balanceAsOf; движения после
          // неё учитываются формулами currentBalanceOf/CURRENT_BALANCE_EXPR,
          // поэтому инкремент запрещён (как в routes/transactions.js).
          if (!isFixed(account) && delta !== 0) updateBalance.run(delta, now, it.accountId)
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

    // Дедуп: ref + содержимое (дата/сумма/счёт). Счёт уже зарезолвлен, поэтому
    // чужая операция с тем же «Номером документа» дублем не считается.
    const existingRows = matchExisting(existingRowsFor(existingByRef, op.externalRef), {
      date: op.date,
      amount: op.amount,
      type: op.type,
      resolvedAccountId,
      transferAccountId: resolvedTransferAccountId
    })
    const dup = !!existingRows
    if (dup) alreadyImported++

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

  // Счёт-специфичные правила учитываем ПОСЛЕ резолва счёта (см. mapping.js).
  return {
    operations: applyRulesToResolvedOperations(result),
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

  // Дедуп по externalRef + содержимому + данные уже сохранённых операций.
  const existingByRef = loadExistingByRef(db, entries.map(e => e.externalRef))

  let alreadyImported = 0
  let unresolvedAccount = 0
  for (const e of entries) {
    const existingRows = matchExisting(existingRowsFor(existingByRef, e.externalRef), e)
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
  // Счёт-специфичные правила учитываем ПОСЛЕ резолва счёта (см. mapping.js).
  // Если правило не сработало, подсказка по категории банка сохраняется.
  return {
    operations: applyRulesToResolvedOperations(result),
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