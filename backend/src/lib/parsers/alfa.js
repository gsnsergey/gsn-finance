// Парсер банковских выписок Альфа-Банка в формате PDF (текстовый, не сканы).
//
// Вход: строка с извлечённым из PDF текстом (или сам Buffer → вызывающий сам
// делает extract через pdf-parse и передаёт сюда text). Выход: массив
// нормализованных операций с полями для дальнейшего маппинга в категории.
//
// Структура одной операции в исходном PDF:
//
//   12.11.2025  CRD_9643H4  Операция по карте: 220015++++++4795, на сумму: 35.00 RUR,
//                            дата совершения 11.11.2025
//                  32410885\RU\MOSCOW\DOSTAVKA IZ PYATEROCH MCC5411
//                                                        -35,00 RUR
//
// Поле «сумма» в Альфе — отдельной строкой со знаком: «-35,00 RUR» (расход),
// «+1 500,00 RUR» (приход). В transactions.amount мы кладём целое число
// копеек (умножаем рубли на 100, знак сохраняем по типу операции).
//
// PDF-текст может «оборачивать» длинные строки в исходнике, поэтому
// парсер работает на логических блоках, а не на посимвольных regex — сначала
// склеиваем переносы внутри одного блока, потом режем по «дата в начале
// строки» как маркеру новой операции.
//
// Детерминированная проверка — в alfa.test.js (node --test). Тест не зависит
// от реального PDF и прогоняется на синтетической фикстуре.

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})/                       // DD.MM.YYYY в начале блока
const CODE_RE = /\b(CRD_[A-Z0-9]{6})\b/                            // уникальный код операции Альфы
const PAN_RE = /(\d{6})\+{4,}(\d{4})/                              // маска карты
const MERCHANT_LINE_RE = /^[\s\d\\]*?\\([A-Z]{2,3})\\([^\\]+)\\([^\s]+(?:\s+[^\s]+)*?)\s+MCC(\d{4})\s*$/
const AMOUNT_RE = /^([+\-−]?)\s*(\d[\d\s]*)[,\.](\d{2})\s*RUR\s*$/   // знак + копейки

/**
 * Парсит текст выписки Альфа-Банка → массив операций.
 * @param {string} text  текст PDF (после pdf-parse)
 * @returns {Array<{
 *   date: string,             // YYYY-MM-DD (локальная дата проводки)
 *   originalDate: string,     // DD.MM.YYYY
 *   externalRef: string,      // CRD_xxxxxx — ключ дедупа в transactions.externalRef
 *   panMask: string,          // 220015++++++4795
 *   mcc: string,              // 5411 (4 цифры)
 *   merchantName: string,     // DOSTAVKA IZ PYATEROCH
 *   terminalId: string,       // 32410885
 *   country: string,          // RU
 *   city: string,             // MOSCOW
 *   amount: number,           // знаковые копейки: -3500 для -35,00 RUR
 *   currency: 'RUR',          // Альфа выписки в рублях
 *   description: string,      // первая строка блока (обрезанная)
 *   type: 'income'|'expense'  // знак суммы
 * }>}
 */
export function parseAlfaStatement(text) {
  if (typeof text !== 'string' || !text.trim()) return []

  // 1. Нормализация: схлопываем висячие пробелы и переносы внутри логической
  //    строки. PDF-парсеры часто разрывают длинные строки на куски, поэтому
  //    первая строка операции может прийти как 2-3 физических строки.
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  // 2. Склейка: логический блок операции начинается со строки «DD.MM.YYYY ...»
  //    в начале. Все строки до следующей даты — часть предыдущего блока.
  const blocks = []
  let current = []
  for (const line of lines) {
    if (DATE_RE.test(line) && current.length > 0) {
      blocks.push(current.join(' | '))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current.join(' | '))

  // 3. Парсинг каждого блока. Невалидные блоки (без кода операции, без даты,
  //    без суммы) молча пропускаются — такие встречаются в шапке/подвале
  //    выписки и в строках итогов.
  const ops = []
  for (const block of blocks) {
    const op = parseBlock(block)
    if (op) ops.push(op)
  }
  return ops
}

function parseBlock(block) {
  const dateMatch = block.match(DATE_RE)
  if (!dateMatch) return null
  const [, dd, mm, yyyy] = dateMatch
  const date = `${yyyy}-${mm}-${dd}`

  const codeMatch = block.match(CODE_RE)
  if (!codeMatch) return null
  const externalRef = codeMatch[1]

  const panMatch = block.match(PAN_RE)
  if (!panMatch) return null
  const panMask = `${panMatch[1]}++++++${panMatch[2]}`

  // Сумма: последняя «RUR»-строка в блоке. Ищем по всему блоку, но
  // приоритет — последняя строка-сумма (в Альфе идёт отдельной логической
  // строкой внизу).
  const amountMatches = [...block.matchAll(/([+\-−])\s*(\d[\d\s]*)[,\.](\d{2})\s*RUR/g)]
  if (!amountMatches.length) return null
  const am = amountMatches[amountMatches.length - 1]
  const signChar = am[1]
  const rubles = Number(am[2].replace(/\s+/g, ''))
  const kopecks = Number(am[3])
  const signedRub = (signChar === '-' || signChar === '−' ? -1 : 1) * rubles
  const amount = signedRub * 100 + Math.sign(signedRub) * kopecks

  // Merchant-строка: ищем фрагмент вида `terminalId\COUNTRY\CITY\MERCHANT MCC\d{4}`.
  // Берём ПОСЛЕДНЕЕ вхождение в блоке (на случай если MCC встретится в описании).
  const merchantRe = /(\d+)\\([A-Z]{2,3})\\([^\\|]+)\\([^\s|][^|]*?)\s+MCC(\d{4})/g
  const merchantMatches = [...block.matchAll(merchantRe)]
  const lastMerchant = merchantMatches[merchantMatches.length - 1]
  if (!lastMerchant) return null

  const terminalId = lastMerchant[1]
  const country = lastMerchant[2]
  const city = lastMerchant[3]
  const merchantName = lastMerchant[4].trim()
  const mcc = lastMerchant[5]

  // Тип операции — по знаку суммы. Альфа сейчас не выделяет переводы между
  // своими счетами отдельным типом, всё уходит в expense/income.
  const type = signedRub < 0 ? 'expense' : 'income'

  // Описание: первая строка блока (после даты и кода операции) — содержит
  // маску карты, фразу «на сумму: N RUR», «дата совершения …».
  // Оставляем как есть, без дополнительной очистки: UI его не показывает,
  // но это пригодится для descriptionRegex-правил.
  const description = block

  return {
    date,
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
    type
  }
}