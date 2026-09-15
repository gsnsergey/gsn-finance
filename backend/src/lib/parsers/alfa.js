// Парсер банковских выписок Альфа-Банка в формате PDF (текстовый, не сканы).
//
// Вход: строка с извлечённым из PDF текстом. Выход: массив нормализованных
// операций с полями для дальнейшего маппинга в категории.
//
// Два формата операций в выписке Альфы:
//
// (1) ПОДТВЕРЖДЁННАЯ (списание уже прошло):
//
//   08.09.2026  CRD_2W0124  Операция по карте: 220015++++++4795, на сумму: 216.97 RUR,
//                            дата совершения операции: 05.09.26, место совершения операции:
//                            24004803\RU\Yagul\PYATEROCHKA 21436 (MP-4001) MCC5411
//                                                                          -216,97 RUR
//
//   • 3 логических строки: проводка / merchant / сумма
//   • дата слева (DD.MM.YYYY)
//   • код операции начинается с CRD_
//   • MCC указан
//
// (2) НЕПОДТВЕРЖДЁННАЯ (HOLD — сумма зарезервирована, ещё не списана):
//
//   HOLD  Неподтвержденная операция: 9BB7W3 31875356 RU MAGNIT DOSTAVKA_YM>Kras
//        13.09.26 13.09.26 1368.89 RUR 220015++++++4795, дата операции: 13.09.2026,
//        дата предполагаемого снятия блокировки: 22.09.2026
//        Сумма, зарезервированная для погашения: 0.00
//                                                                          -1 368,89 RUR
//
//   • 2 логических строки: HOLD-строка / сумма
//   • даты слева нет — вместо неё слово «HOLD»
//   • код операции другой формат: «Неподтвержденная операция: <ID>» (без CRD_)
//   • MCC отсутствует
//   • merchant/country/terminalId идут сплошным фрагментом `TERMINAL\COUNTRY\MERCHANT>CITY…`
//   • дата операции — внутри текста после фразы «дата операции: DD.MM.YYYY»
//
// ОШИБКА, пойманная 2026-09-15: если маркер начала блока — только «дата в начале
// строки», то HOLD-строка приклеивается к предыдущему блоку, и в склеенном
// блоке берётся «последняя» сумма (= HOLD), но date/externalRef/MCC — от
// предыдущей операции. Получается испорченная запись в transactions: чужой
// externalRef, чужая дата, чужой MCC + чужая сумма.
//
// Теперь маркер начала блока — `DD.MM.YYYY` ИЛИ `HOLD`, плюс для HOLD
// извлекаются поля по отдельным regex'ам.

const DATE_LINE_RE = /^(\d{2})\.(\d{2})\.(\d{4})/      // DD.MM.YYYY в начале строки
const HOLD_LINE_RE = /^HOLD\b/                          // начало HOLD-блока
const BLOCK_START_RE = /^(\d{2}\.\d{2}\.\d{4}|HOLD)\b/  // маркер начала нового блока

const CODE_RE = /\b(CRD_[A-Z0-9]{6})\b/                // уникальный код подтверждённой операции
// PAN может разрываться pdf-парсером между строками: «220015+++++» + «+4795».
// Поэтому между группами плюсов допускаем 0+ любых плюсов и пробелов.
const PAN_RE = /(\d{6})\+[\s\+]*?(\d{4})/
const AMOUNT_RE = /([+\-−])\s*(\d[\d\s]*)[,\.](\d{2})\s*RUR/g

// Регулярка для merchant-строки обычной операции: terminalId\COUNTRY\CITY\MERCHANT MCC\d{4}
const MERCHANT_RE = /(\d+)\\([A-Z]{2,3})\\([^\\|]+)\\([^\s|][^|]*?)\s+MCC(\d{4})/g

/**
 * Парсит текст выписки Альфа-Банка → массив операций.
 * @param {string} text  текст PDF (после pdf-parse)
 * @returns {Array<{
 *   date: string,
 *   originalDate: string,
 *   externalRef: string,
 *   panMask: string,
 *   mcc: string|null,
 *   merchantName: string,
 *   terminalId: string,
 *   country: string,
 *   city: string,
 *   amount: number,           // знаковые копейки
 *   currency: 'RUR',
 *   description: string,
 *   type: 'income'|'expense',
 *   confirmed: boolean        // false для HOLD-операций (зарезервировано, не списано)
 * }>}
 */
export function parseAlfaStatement(text) {
  if (typeof text !== 'string' || !text.trim()) return []

  // 1. Нормализация: схлопываем висячие пробелы и переносы внутри логической
  //    строки. PDF-парсеры часто разрывают длинные строки на куски, поэтому
  //    первая строка операции может прийти как 2-3 физических строки.
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  // 2. Склейка блоков. Маркер начала: «DD.MM.YYYY» (обычная) ИЛИ «HOLD».
  //    Каждый блок — строки от маркера до следующего маркера (включительно).
  //
  //    Склеиваем строки через пробел (БЕЗ ` | `-разделителя): длинные токены
  //    типа PAN `220015++++++4795` могут разрываться pdf-парсером между
  //    строками (например, `220015+++++` + `+4795`), и разделитель ломает
  //    regex (\d{6}\+{4,}\d{4}). С description для UI работаем отдельно.
  const blocks = []
  let current = []
  let currentRaw = []   // для description (с разделителем « | » — читабельно)
  for (const line of lines) {
    if (BLOCK_START_RE.test(line) && current.length > 0) {
      blocks.push({ text: current.join(' '), description: currentRaw.join(' | ') })
      current = [line]
      currentRaw = [line]
    } else {
      current.push(line)
      currentRaw.push(line)
    }
  }
  if (current.length) blocks.push({ text: current.join(' '), description: currentRaw.join(' | ') })

  // 3. Парсинг каждого блока. Невалидные (без даты/PAN/суммы) пропускаются.
  const ops = []
  for (const { text, description } of blocks) {
    const op = parseBlock(text, description)
    if (op) ops.push(op)
  }
  return ops
}

function parseBlock(block, description) {
  if (HOLD_LINE_RE.test(block)) return parseHoldBlock(block, description)
  return parseRegularBlock(block, description)
}

// =================================================================
// Подтверждённая операция: 3 строки, дата слева, код CRD_xxxxxx, MCC есть.
// =================================================================
function parseRegularBlock(block, description) {
  const dateMatch = block.match(DATE_LINE_RE)
  if (!dateMatch) return null
  const [, dd, mm, yyyy] = dateMatch

  const codeMatch = block.match(CODE_RE)
  if (!codeMatch) return null

  const panMatch = block.match(PAN_RE)
  if (!panMatch) return null
  const panMask = `${panMatch[1]}++++++${panMatch[2]}`

  // Сумма — последняя «±N,NK RUR» в блоке.
  const amountMatches = [...block.matchAll(AMOUNT_RE)]
  if (!amountMatches.length) return null
  const am = amountMatches[amountMatches.length - 1]
  const { amount, signedRub } = parseAmountMatch(am)

  // Merchant — последний фрагмент вида `terminal\COUNTRY\CITY\MERCHANT MCC\d{4}`.
  const merchantMatches = [...block.matchAll(MERCHANT_RE)]
  if (!merchantMatches.length) return null
  const last = merchantMatches[merchantMatches.length - 1]

  return {
    date: `${yyyy}-${mm}-${dd}`,
    originalDate: `${dd}.${mm}.${yyyy}`,
    externalRef: codeMatch[1],
    panMask,
    mcc: last[5],
    merchantName: last[4].trim(),
    terminalId: last[1],
    country: last[2],
    city: last[3],
    amount,
    currency: 'RUR',
    description,
    type: signedRub < 0 ? 'expense' : 'income',
    confirmed: true
  }
}

// =================================================================
// Неподтверждённая операция (HOLD): 2 строки, маркер «HOLD», код другой.
//
//   HOLD Неподтвержденная операция: 9BB7W3 31875356 RU MAGNIT DOSTAVKA_YM>Kras
//        13.09.26 13.09.26 1368.89 RUR 220015++++++4795, дата операции: 13.09.2026,
//        дата предполагаемого снятия блокировки: 22.09.2026
//   -1 368,89 RUR
// =================================================================
function parseHoldBlock(block, description) {
  // Дата операции (НЕ дата блокировки — последняя в тексте, нам не нужна).
  // Якорь: «дата операции: DD.MM.YYYY». В Альфе это поле есть всегда.
  const dateOpRe = /дата операции:\s*(\d{2})\.(\d{2})\.(\d{4})/
  const dm = block.match(dateOpRe)
  if (!dm) return null
  const [, dd, mm, yyyy] = dm

  // Код операции: после «Неподтвержденная операция:» идёт ID (4-8 алф. символов),
  // потом — terminalId, потом RU, потом merchant. ID без префикса CRD_.
  const idRe = /Неподтвержденная операция:\s*([A-Z0-9]{4,8})\s+(\d+)\s+([A-Z]{2,3})\s+(.+?)>([A-Za-zА-Яа-яЁё]+)/
  const im = block.match(idRe)
  if (!im) return null
  const [, externalRef, terminalId, country, merchantCityBlob, city] = im
  // merchantCityBlob = «MAGNIT DOSTAVKA_YM» — всё до «>». merchantName = часть до первой «>»,
  // но мы уже отрезали по «>» — берём всё.
  const merchantName = merchantCityBlob.trim()

  // PAN и сумма — стандартные regex.
  const panMatch = block.match(PAN_RE)
  if (!panMatch) return null
  const panMask = `${panMatch[1]}++++++${panMatch[2]}`

  const amountMatches = [...block.matchAll(AMOUNT_RE)]
  if (!amountMatches.length) return null
  const am = amountMatches[amountMatches.length - 1]
  const { amount, signedRub } = parseAmountMatch(am)

  // HOLD-операции в Альфе — всегда расходы (зарезервированная сумма).
  return {
    date: `${yyyy}-${mm}-${dd}`,
    originalDate: `${dd}.${mm}.${yyyy}`,
    externalRef,
    panMask,
    mcc: null,
    merchantName,
    terminalId,
    country,
    city,
    amount,
    currency: 'RUR',
    description,
    type: signedRub < 0 ? 'expense' : 'income',
    confirmed: false
  }
}

// =================================================================
// Хелпер: разбирает match из AMOUNT_RE в знаковые копейки + знаковые рубли.
// AMOUNT_RE: ([+\-−]) (\d[\d\s]*) [,\.] (\d{2}) \s* RUR
//   am[1] = знак (+, -, −), am[2] = рубли с возможными пробелами, am[3] = копейки.
// =================================================================
function parseAmountMatch(am) {
  const signChar = am[1]
  const rubles = Number(am[2].replace(/\s+/g, ''))
  const kopecks = Number(am[3])
  const sign = (signChar === '-' || signChar === '−') ? -1 : 1
  const signedRub = sign * rubles
  const amount = signedRub * 100 + sign * kopecks
  return { amount, signedRub }
}