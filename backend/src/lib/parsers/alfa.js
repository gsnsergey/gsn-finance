// Парсер банковских выписок Альфа-Банка в формате PDF (текстовый, не сканы).
//
// Вход: строка с извлечённым из PDF текстом. Выход: массив операций
// с полями для дальнейшего маппинга в категории.
//
// Три жанра операций в выписке Альфы:
//
// (1) ПОДТВЕРЖДЁННАЯ КАРТОЧНАЯ (3 строки, MCC + PAN + merchant):
//
//   08.09.2026  CRD_2W0124  Операция по карте: 220015++++++4795, на сумму: 216.97 RUR, дата совершения операции: 05.09.26, место совершения операции:
//                            24004803\RU\Yagul\PYATEROCHKA 21436 (MP-4001) MCC5411
//                                                                          -216,97 RUR
//
// (2) НЕПОДТВЕРЖДЁННАЯ (HOLD — резерв, ещё не списано, 2 строки):
//
//   HOLD  Неподтвержденная операция: 9BB7W3 31875356 RU MAGNIT DOSTAVKA_YM>Kras13.09.26 13.09.26 1368.89 RUR 220015++++++4795, дата операции: 13.09.2026, дата предполагаемого снятия блокировки: 22.09.2026
//                  Сумма, зарезервированная для погашения: 0.00
//                                                                          -1 368,89 RUR
//
// (3) ПЛАТЁЖ ЧЕРЕЗ СИСТЕМУ АЛЬФА (1 строка, без MCC/PAN/merchant):
//
//   02.09.2026 A220209260028842 Платеж A220209260028842 по оплате штрафа ГИБДД -562,50 RUR
//
//   Это штрафы ГИБДД, СБП-переводы, оплата ЖКХ/мобильной связи/налогов —
//   всё что Альфа проводит не через карточный терминал, а через свои
//   платёжные сервисы. ID операции — произвольный формат (часто `A` + 13 цифр),
//   нет ни MCC, ни PAN, ни merchant.
//
// Парсер толерантен: распознаёт все три жанра, и если в блоке есть хоть
// дата + сумма — операция попадает в список. Поле recognitionLevel показывает,
// насколько полно распознан блок:
//   - 'full'    : дата + ID + PAN + MCC + merchant + сумма
//   - 'partial' : дата + (ID или PAN) + сумма, но чего-то нет (нет MCC, или merchant)
//   - 'minimal' : только дата + сумма (платёж ГИБДД, СБП)
//
// Сумма и знак обязательны — без них блок отбрасывается (заголовок/итог/пустота).

const DATE_LINE_RE = /^(\d{2})\.(\d{2})\.(\d{4})/      // DD.MM.YYYY в начале строки
const HOLD_LINE_RE = /^HOLD\b/                          // начало HOLD-блока
const BLOCK_START_RE = /^(\d{2}\.\d{2}\.\d{4}|HOLD)\b/  // маркер начала нового блока

// Коды операций Альфы в разных форматах. ВАЖНО: ловим в порядке от «самого
// специфичного» к «самому общему», чтобы CRD_… не перебивался общим regex.
//   CRD_xxxxxx  — карточная операция (10 символов: CRD_ + 6)
//   A\d{13}     — платёж через Альфа-систему (штрафы ГИБДД, СБП, ЖКХ): A + 13 цифр
//   Прочее      — fallback: первое «алфанум»-слово, но НЕ 4 цифры подряд (чтобы
//                не захватить год из даты «02.09.2026» → fallback найдёт «A220…», а не «2026»).
const CODE_RES = [
  /\b(CRD_[A-Z0-9]{6})\b/,
  /\b(A\d{13})\b/,
  /\b((?!\d{4}\b)[A-Z0-9][A-Z0-9_]{3,20})\b/
]

// PAN может разрываться pdf-парсером между строками: «220015+++++» + «+4795».
// Поэтому между группами плюсов допускаем 0+ любых плюсов и пробелов.
const PAN_RE = /(\d{6})\+[\s\+]*?(\d{4})/

// Сумма в RUR. Знак ОПЦИОНАЛЕН: Альфа выдаёт расходы с «−» или «-» (явный
// минус), а поступления — часто БЕЗ знака («15 000,00 RUR»). Если знака нет
// — это income (поступление). Расходы в Альфе всегда идут с явным «−».
//
// Защита от ложных срабатываний: в parseRegularBlock мы дополнительно
// требуем наличие кода операции в блоке. Итоги/заголовки («Итого по счёту:
// 12 345,67 RUR») идут обычно без кода и поэтому отбрасываются.
const AMOUNT_RE = /(?:([+\-−])\s*)?(\d[\d\s]*)[,\.](\d{2})\s*RUR/g

// Регулярка для merchant-строки обычной операции: terminalId\COUNTRY\CITY\MERCHANT MCC\d{4}
const MERCHANT_RE = /(\d+)\\([A-Z]{2,3})\\([^\\|]+)\\([^\s|][^|]*?)\s+MCC(\d{4})/g

/**
 * Парсит текст выписки Альфа-Банка → массив операций.
 * @param {string} text  текст PDF (после pdf-parse)
 * @returns {Array<{
 *   date: string,
 *   originalDate: string,
 *   externalRef: string|null,
 *   panMask: string|null,
 *   mcc: string|null,
 *   merchantName: string|null,
 *   terminalId: string|null,
 *   country: string|null,
 *   city: string|null,
 *   amount: number,
 *   currency: 'RUR',
 *   description: string,
 *   type: 'income'|'expense',
 *   confirmed: boolean,
 *   recognitionLevel: 'full'|'partial'|'minimal'
 * }>}
 */
export function parseAlfaStatement(text) {
  if (typeof text !== 'string' || !text.trim()) return []

  // 1. Нормализация.
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  // 2. Склейка блоков (DD.MM.YYYY или HOLD).
  const blocks = []
  let current = []
  let currentRaw = []
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

  // 3. Парсинг. Блок без даты или без суммы — пропускается (шапка/итог).
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
// Подтверждённая операция: дата слева, ID любого формата. PAN/MCC/merchant
// опциональны — для платежей через Альфа-систему их нет.
// =================================================================
function parseRegularBlock(block, description) {
  const dateMatch = block.match(DATE_LINE_RE)
  if (!dateMatch) return null
  const [, dd, mm, yyyy] = dateMatch

  // ID операции: первый подходящий из CODE_RES. Может быть null (неизвестный формат).
  // Наличие кода — обязательный признак ОПЕРАЦИИ (vs итогов/заголовков). С ним
  // AMOUNT_RE без знака не сматчит «Итого по счёту: 12 345,67 RUR» как income.
  let externalRef = null
  for (const re of CODE_RES) {
    const m = block.match(re)
    if (m) { externalRef = m[1]; break }
  }
  if (!externalRef) return null

  // Сумма — обязательна. Без неё блок не считается операцией.
  const amountMatches = [...block.matchAll(AMOUNT_RE)]
  if (!amountMatches.length) return null
  const am = amountMatches[amountMatches.length - 1]
  const { amount, signedRub } = parseAmountMatch(am)

  // PAN — опционален (платежи через Альфа-систему идут без карты).
  let panMask = null
  const panMatch = block.match(PAN_RE)
  if (panMatch) panMask = `${panMatch[1]}++++++${panMatch[2]}`

  // MCC + merchant — опциональны. Только карточные операции Альфы содержат
  // фрагмент вида `terminalId\COUNTRY\CITY\MERCHANT MCC\d{4}`.
  let mcc = null
  let merchantName = null
  let terminalId = null
  let country = null
  let city = null
  const merchantMatches = [...block.matchAll(MERCHANT_RE)]
  if (merchantMatches.length) {
    const last = merchantMatches[merchantMatches.length - 1]
    mcc = last[5]
    merchantName = last[4].trim()
    terminalId = last[1]
    country = last[2]
    city = last[3]
  }

  // Recognition level — для UI-подсветки.
  //   full    : PAN + MCC + merchant — карточная операция с полными данными
  //   partial : есть PAN или MCC, но не оба + merchant — переводы и пр.
  //   minimal : нет ни MCC, ни merchant — платежи через Альфа-систему
  //             (штрафы ГИБДД, СБП, ЖКХ, налоги)
  const hasMerchant = mcc !== null && merchantName !== null
  const hasCard = panMask !== null
  let recognitionLevel
  if (hasMerchant && hasCard) recognitionLevel = 'full'
  else if (hasMerchant || hasCard) recognitionLevel = 'partial'
  else recognitionLevel = 'minimal'

  return {
    date: `${yyyy}-${mm}-${dd}`,
    originalDate: `${dd}.${mm}.${yyyy}`,
    externalRef,
    panMask,
    mcc,
    merchantName,
    terminalId,
    country,
    city,
    amount,
    currency: 'RUR',
    description,
    type: signedRub < 0 ? 'expense' : 'income',
    confirmed: true,
    recognitionLevel
  }
}

// =================================================================
// HOLD: 2 строки, маркер «HOLD», код после «Неподтвержденная операция:».
// =================================================================
function parseHoldBlock(block, description) {
  const dateOpRe = /дата операции:\s*(\d{2})\.(\d{2})\.(\d{4})/
  const dm = block.match(dateOpRe)
  if (!dm) return null
  const [, dd, mm, yyyy] = dm

  const idRe = /Неподтвержденная операция:\s*([A-Z0-9]{4,8})\s+(\d+)\s+([A-Z]{2,3})\s+(.+?)>([A-Za-zА-Яа-яЁё]+)/
  const im = block.match(idRe)
  if (!im) return null
  const [, externalRef, terminalId, country, merchantCityBlob, city] = im
  const merchantName = merchantCityBlob.trim()

  const panMatch = block.match(PAN_RE)
  if (!panMatch) return null
  const panMask = `${panMatch[1]}++++++${panMatch[2]}`

  const amountMatches = [...block.matchAll(AMOUNT_RE)]
  if (!amountMatches.length) return null
  const am = amountMatches[amountMatches.length - 1]
  const { amount, signedRub } = parseAmountMatch(am)

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
    confirmed: false,
    recognitionLevel: 'partial'  // HOLD всегда без MCC
  }
}

// =================================================================
// Хелпер: AMOUNT_RE → знаковые копейки.
// =================================================================
function parseAmountMatch(am) {
  // am[1] — знак или undefined (если Альфа выдала сумму без знака, т. е. income).
  // am[2] — рубли. am[3] — копейки (после запятой).
  const signChar = am[1]
  const rubles = Number(am[2].replace(/\s+/g, ''))
  const kopecks = Number(am[3])
  // Расходы Альфа всегда сопровождает явным «-» или «−». Поступления часто
  // идут без знака — трактуем отсутствие как +1.
  const sign = (signChar === '-' || signChar === '−') ? -1 : +1
  const signedRub = sign * rubles
  const amount = signedRub * 100 + sign * kopecks
  return { amount, signedRub }
}