// Парсер банковских выписок Альфа-Банка в формате CSV.
//
// Вход: текст CSV-выписки (UTF-8, BOM в начале допустим, разделитель `,`).
// Выход: массив операций с тем же контрактом, что у parseAlfaStatement (PDF)
// и parseTochkaStatement (CSV), плюс специализированные поля выписки Альфы.
//
// Формат Альфы (16 колонок, шапка обязательна):
//
//   operationDate,transactionDate,accountName,accountNumber,cardName,cardNumber,
//   merchant,amount,currency,status,category,mcc,type,comment,bonusValue,bonusTitle
//
// Пример строки:
//
//   14.09.2026,,"Текущий счёт",40817810505974389734,"Виртуальная карта…",
//   220015******4795,"Krasnodar/MAGNIT DOSTAVKA_YM",1315.53,RUR,"В обработке",
//   Продукты,5411,Списание,,,
//
// Особенности, из-за которых нельзя обойтись split(','):
//   - поля квотируются (`"Текущий счёт"`), внутри кавычек бывают запятые
//     (категория «Связь, интернет и ТВ») и экранированные кавычки (`""`);
//   - десятичный разделитель — точка (`1315.53`), суммы только положительные,
//     а знак определяется колонкой `type` (Списание/Пополнение);
//   - уникального ID операции в файле НЕТ (в отличие от PDF-выписки, где есть
//     `CRD_xxxxxx`). Поэтому externalRef синтезируется детерминированно из
//     полей строки + порядкового номера одинаковых строк — повторный импорт
//     того же файла даёт те же ключи и дедуп работает.
//
// Ключевые колонки:
//   - operationDate  — дата проводки, DD.MM.YYYY → date (ISO) + originalDate
//   - transactionDate — дата совершения, сохраняем отдельно (может быть пустой)
//   - accountNumber  — р/с (20 цифр), по нему preview резолвит счёт (bank=alfa)
//   - cardNumber     — маска `220015******4795`; в БД карты хранятся с `+`
//                      (`220015++++++4795`), здесь `*` → `+`
//   - merchant       — `City\MERCHANT` или `City/MERCHANT`, либо просто текст
//   - status         — `Выполнен` / `В обработке` (pending → confirmed=false)
//   - category       — категория Альфы; у переводов между своими счетами
//                      всегда `Между своими счетами` (isOwnTransfer)
//   - mcc            — 4 цифры для карточных операций, иначе пусто
//   - type           — `Списание` (expense) или `Пополнение` (income)

import { createHash } from 'node:crypto'

const BOM = '\uFEFF'
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/

// Обязательные колонки. Если Альфа поменяет шапку — упадём с понятной ошибкой
// на первом же вызове, а не молча потеряем операции.
const COL = {
  operationDate:   'operationDate',
  transactionDate: 'transactionDate',
  accountName:     'accountName',
  accountNumber:   'accountNumber',
  cardName:        'cardName',
  cardNumber:      'cardNumber',
  merchant:        'merchant',
  amount:          'amount',
  currency:        'currency',
  status:          'status',
  category:        'category',
  mcc:             'mcc',
  type:            'type',
  comment:         'comment',
  bonusValue:      'bonusValue',
  bonusTitle:      'bonusTitle'
}

// Категория Альфы для переводов между собственными счетами. Такие строки
// идут парами (Списание на одном счёте + Пополнение на другом) — preview
// склеивает их в одну операцию type='transfer' (см. lib/import.js).
export const OWN_TRANSFER_CATEGORY = 'Между своими счетами'

/**
 * Парсит CSV-выписку Альфа-Банка → массив операций.
 * @param {string} text  UTF-8 текст CSV (с BOM или без)
 * @returns {Array<object>}
 */
export function parseAlfaCsvStatement(text) {
  if (typeof text !== 'string' || !text.trim()) return []

  const clean = text.startsWith(BOM) ? text.slice(1) : text
  const rows = parseCsv(clean)
  if (rows.length < 2) return []

  const header = rows[0].cells.map(s => s.trim())
  const ix = {}
  for (const [key, colName] of Object.entries(COL)) {
    const idx = header.indexOf(colName)
    if (idx < 0) {
      throw new Error(`parseAlfaCsvStatement: header не содержит колонку «${colName}». Возможно, формат выписки изменился.`)
    }
    ix[key] = idx
  }

  const ops = []
  // Счётчик одинаковых строк: у Альфы нет ID, а две реально разные операции
  // (два одинаковых кофе в один день) должны получить разные externalRef,
  // иначе вторая потеряется как дубль.
  const keyCounts = new Map()

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const op = parseRow(rows[rowIdx].cells, ix, keyCounts, rows[rowIdx].raw)
    if (op) ops.push(op)
  }
  return ops
}

function parseRow(cells, ix, keyCounts, rawLine) {
  const get = key => (cells[ix[key]] !== undefined ? String(cells[ix[key]]).trim() : '')

  // Дата проводки обязательна — без неё строку не с чем записать.
  const dm = get('operationDate').match(DATE_RE)
  if (!dm) return null
  const [, dd, mm, yyyy] = dm

  // Тип обязателен: только он задаёт знак (в CSV суммы всегда положительные).
  const typeRaw = get('type')
  let type
  if (typeRaw === 'Списание') type = 'expense'
  else if (typeRaw === 'Пополнение') type = 'income'
  else return null

  // Сумма: точка как десятичный разделитель, пробелы-разделители тысяч.
  const amountStr = get('amount').replace(/\s+/g, '')
  if (!amountStr) return null
  const rubles = Number(amountStr.replace(',', '.'))
  if (!Number.isFinite(rubles)) return null
  const absKopecks = Math.round(rubles * 100)

  const transactionDate = parseDate(get('transactionDate'))
  const status = get('status')
  // «В обработке» — банк ещё не провёл операцию (аналог HOLD в PDF-выписке):
  // не подтверждена, UI подсветит жёлтым.
  const confirmed = status !== 'В обработке'

  const cardNumber = get('cardNumber')
  const panMask = cardNumber ? cardNumber.replace(/\*+/g, m => '+'.repeat(m.length)) : null

  const merchantRaw = get('merchant')
  const { merchantName, city } = splitMerchant(merchantRaw)

  const mcc = get('mcc') || null
  const bankCategory = get('category') || null
  const comment = get('comment') || null

  const accountNumber = get('accountNumber') || null

  // externalRef — детерминированный синтетический ключ. Префикс `alfacsv-`
  // отличает его от настоящих ID (`CRD_…`) и от `tchk-…` Точки.
  const baseKey = [
    `${yyyy}-${mm}-${dd}`,
    transactionDate || '',
    accountNumber || '',
    panMask || '',
    type,
    absKopecks,
    merchantRaw,
    status
  ].join('|')
  const occ = (keyCounts.get(baseKey) || 0) + 1
  keyCounts.set(baseKey, occ)
  const hash = createHash('sha1').update(baseKey).digest('hex').slice(0, 16)
  const externalRef = `alfacsv-${hash}${occ > 1 ? `-${occ}` : ''}`

  const signedKopecks = type === 'expense' ? -absKopecks : absKopecks

  let recognitionLevel
  if (panMask && mcc) recognitionLevel = 'full'
  else if (panMask || mcc) recognitionLevel = 'partial'
  else recognitionLevel = 'minimal'

  const description = comment ? `${merchantRaw} — ${comment}` : merchantRaw

  return {
    date: `${yyyy}-${mm}-${dd}`,
    originalDate: `${dd}.${mm}.${yyyy}`,
    transactionDate,
    externalRef,
    accountName: get('accountName') || null,
    accountNumber,
    cardName: get('cardName') || null,
    panMask,
    mcc,
    merchantName: merchantName || null,
    terminalId: null,
    country: city ? 'RU' : null,
    city,
    amount: signedKopecks,
    currency: get('currency') || 'RUR',
    description,
    type,
    confirmed,
    status,
    recognitionLevel,
    // Признак «перевод между своими счетами» — preview склеит пары в transfer.
    isOwnTransfer: bankCategory === OWN_TRANSFER_CATEGORY,
    bankCategory,
    comment,
    bonusValue: get('bonusValue') || null,
    bonusTitle: get('bonusTitle') || null,
    // Исходная строка CSV (как в файле) — UI показывает её по кнопке.
    rawSource: rawLine || null
  }
}

// `Krasnodar\MAGNIT DOSTAVKA YM` / `Krasnodar/MAGNIT DOSTAVKA_YM` →
// city='Krasnodar', merchantName='MAGNIT DOSTAVKA YM'. Простой текст без
// разделителя возвращается как merchantName целиком.
function splitMerchant(raw) {
  if (!raw) return { merchantName: null, city: null }
  const sep = raw.search(/[\\/]/)
  if (sep <= 0) return { merchantName: raw.trim(), city: null }
  const city = raw.slice(0, sep).trim()
  const name = raw.slice(sep + 1).trim()
  if (!name) return { merchantName: raw.trim(), city: null }
  return { merchantName: name, city: city || null }
}

function parseDate(value) {
  const m = String(value || '').match(DATE_RE)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * CSV-парсер (RFC 4180-совместимый): запятая-разделитель, двойные кавычки,
 * удвоение кавычек внутри поля, переносы строк внутри квотированного поля.
 * Для каждой строки сохраняем и исходный текст (`raw`) — UI показывает его
 * по кнопке «исходные данные из файла».
 * @returns {Array<{cells: string[], raw: string}>}
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  let rowStart = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n') {
      row.push(cur)
      rows.push({ cells: row, raw: text.slice(rowStart, i).replace(/\r$/, '') })
      row = []; cur = ''; rowStart = i + 1
    }
    else if (ch === '\r') { /* CRLF — \n обработает */ }
    else cur += ch
  }
  // Последняя строка без завершающего перевода строки.
  if (cur.length > 0 || row.length > 0) {
    row.push(cur)
    rows.push({ cells: row, raw: text.slice(rowStart).replace(/\r$/, '') })
  }

  // Отбрасываем полностью пустые строки (хвостовые переводы строк).
  return rows.filter(r => r.cells.some(c => String(c).trim().length > 0))
}
