// Парсер банковских выписок Точка-Банка в формате CSV.
//
// Вход: текст CSV (UTF-8, BOM в начале допустим). Разделитель `;`, 42 колонки.
// Выход: массив операций с полями, идентичными parseAlfaStatement по контракту
// (date, originalDate, externalRef, panMask, mcc, merchantName, terminalId,
// country, city, amount, currency, description, type, confirmed, recognitionLevel),
// плюс специализированные поля для Точки:
//
//   direction        : 'incoming' | 'outgoing'   (Направление из CSV)
//   payerName, payeeName, payerAccount, payeeAccount
//   payerInn, payeeInn, payerBik, payeeBik
//   docNumber        : номер документа (int как строка)
//
// Жанры операций в выписке (по подстроке в «Назначение платежа»):
//
//   (1) «Покупка товара(Терминал:...,карта 5140********2748)» — карточная
//       операция. PAN + merchant + city + country извлекаются regex.
//
//   (2) «Перевод по номеру телефона +7 … через СБП.» — СБП-перевод.
//       type определяется по «Направление» (исходящий → expense, входящий → income).
//
//   (3) «Перевод собственных средств.» — перевод между своими счетами.
//       type = 'transfer' (НЕ income/expense). Бэкенд запишет 2 записи в
//       transactions с общим externalRef.
//
//   (4) «Списание по QR коду ID AD10000...» / «ID BD10002...» — оплата по QR.
//
//   (5) «Налог, взимаемый в связи с применением УСН...» — налог ИП.
//
//   (6) «Оплата по счету/акту/договору №…» — оплата от/к контрагента.
//       Входящая → income, исходящая → expense.
//
//   (7) Прочее — expense/income по направлению, минимальный recognitionLevel.
//
// Парсер толерантен: если в строке нет ни даты, ни суммы — пропускает.
// Распознанные блоки: externalRef из «Номер документа» (стабильный у Точки;
// для пустого — `tchk-{date}-{amount}-{rowIdx}`, чтобы дедуп работал).
//
// `recognitionLevel`:
//   - 'full'    : карточная операция с PAN + merchant + city
//   - 'partial' : СБП / QR / оплата по счёту — есть контрагент, но нет PAN/MCC
//   - 'minimal' : собственные переводы / резервные случаи — только дата + сумма

// BOM — Точка сохраняет файл как CSV (UTF-8 BOM), парсер снимает его,
// иначе первая колонка header'а будет \uFEFF + «Дата проводки».
const BOM = '\uFEFF'

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/             // DD.MM.YYYY

// Поля, которые мы вытаскиваем из CSV. Индексы по фиксированному header'у.
// Если Точка поменяет порядок колонок — упадём в первом call'е с понятной ошибкой.
const COL = {
  dateOp:        'Дата проводки',
  dateDoc:       'Дата документа',
  dateDebit:     'Дата списания',
  dateCredit:    'Дата зачисления',
  docNumber:     'Номер документа',
  direction:     'Направление',
  amount:        'Сумма операции',
  amountRub:     'Сумма операции в рублях',
  openingBal:     'Входящий остаток',
  closingBal:    'Исходящий остаток',
  purpose:       'Назначение платежа',
  payerName:     'Наименование плательщика',
  payerAccount:  'Счет плательщика',
  payerInn:      'ИНН плательщика',
  payerKpp:      'КПП плательщика',
  payerBik:      'Бик банка плательщика',
  payeeName:     'Наименование получателя',
  payeeAccount:  'Счет получателя',
  payeeInn:      'ИНН получателя',
  payeeKpp:      'КПП получателя',
  payeeBik:      'Бик банка получателя',
  rate:          'Курс конвертации',
  amountAfter:   'Сумма после конвертации',
  priority:      'Приоритет',
  docType:       'Тип документа'
}

// Regex'ы по «Назначению платежа». Самая длинная и специфичная первой —
// чтобы СБП-перевод не перебился общим «Перевод собственных средств».
const PURPOSE_RES = [
  // (1) Карточная операция: «Покупка товара(Терминал:MERCHANT,ADDR,CITY,RU,дата операции:DD/MM/YYYY HH:MM(МСК),на сумму:X RUB,карта 5140********2748)»
  // Структура поля: 4 куска до «,RU» — merchant, адрес (одна или несколько
  // запятых внутри, но regex не greedy возьмёт первый кусок), city.
  // Реальные примеры из выписки:
  //   «Терминал:FRENSIS PETROVSKIJ,STR IM PETROVA 29,Izhevsk,RU»
  //   «Терминал:18004 AZS 4 IZHEVSK,UL. BUMMASHEVSKAYA D. 1,Izhevsk,RU»
  //   «Терминал:PYATEROCHKA 26678,STR PUSHINOY 127,Yakshur-Bodya,RU»
  /^Покупка товара\(Терминал:([^,]+),([^,]+),([^,]+),RU,дата операции:(\d{2}\/\d{2}\/\d{4})[^,]*,\s*на сумму:[\d\s]+ RUB,\s*карта\s+(\d{4})\*+(\d{4})\)/i,

  // (2) СБП: «Перевод по номеру телефона +7 ... Получатель … через СБП.»
  /^Перевод по номеру телефона\s+\+?\d[\d\s-]+\s+Получатель\s+.+?\s+через СБП\.?$/i,

  // (3) Собственные средства: «Перевод собственных средств.» или
  //     «Перевод собственных средств. Без НДС.» — после «.» может идти дополнение.
  /^Перевод собственных средств\.?/i,

  // (4) QR: «Списание по QR коду ID <ID>...»
  /^Списание по QR коду\s+ID\s+([A-Z0-9]+)/i,

  // (5) Налог
  /^Налог,/i
]

/**
 * Парсит текст CSV-выписки Точка-Банка → массив операций.
 * @param {string} text  UTF-8 текст CSV (с BOM или без)
 * @returns {Array<object>}
 */
export function parseTochkaStatement(text) {
  if (typeof text !== 'string' || !text.trim()) return []

  // Снимаем BOM.
  const clean = text.startsWith(BOM) ? text.slice(1) : text

  // Простой CSV-парсер: split по \n (выписки LF, не CRLF), split по ';'.
  // Точка экспортирует в LF — проверил на sample. Если появится CRLF — тоже
  // сработает через \r? перед split.
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []

  // Header → индексы колонок. Если Точка переставит колонки — кидаем понятную ошибку.
  const header = lines[0].split(';').map(s => s.trim())
  const ix = {}
  for (const [key, colName] of Object.entries(COL)) {
    const idx = header.indexOf(colName)
    if (idx < 0) {
      throw new Error(`parseTochkaStatement: header не содержит колонку «${colName}». Возможно, формат выписки изменился.`)
    }
    ix[key] = idx
  }

  const ops = []
  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cells = lines[rowIdx].split(';')
    const op = parseRow(cells, ix, rowIdx)
    if (op) ops.push(op)
  }
  return ops
}

function parseRow(cells, ix, rowIdx) {
  const get = key => (cells[ix[key]] || '').trim()

  // Дата — обязательна. Если нет — пропускаем строку (шапка, футер, мусор).
  const dateStr = get('dateOp') || get('dateDoc')
  const dm = dateStr.match(DATE_RE)
  if (!dm) return null
  const [, dd, mm, yyyy] = dm

  // Сумма в рублях — обязательна. Запятая как разделитель.
  const amountStr = (get('amountRub') || get('amount')).replace(/\s+/g, '')
  if (!amountStr) return null
  const amountRub = Number(amountStr.replace(',', '.'))
  if (!Number.isFinite(amountRub)) return null

  // Сумма в копейках. В выписке суммы положительные — знак из «Направление».
  const directionRaw = get('direction')
  const direction = directionRaw === 'Входящий' ? 'incoming'
                 : directionRaw === 'Исходящий' ? 'outgoing'
                 : null
  if (!direction) return null

  const purposeText = get('purpose')
  const docNumber = get('docNumber')

  // externalRef: стабильный идентификатор операции в выписке. У Точки это
  // «Номер документа» (например «558086») — уникален в пределах выписки.
  // Для пустого docNumber (бывает редко, для входящих с малым док.номером)
  // синтезируем из даты+суммы+индекса строки — для дедупа хватит.
  const externalRef = docNumber
    ? `tchk-doc-${docNumber}`
    : `tchk-row-${rowIdx}-${yyyy}${mm}${dd}-${Math.round(amountRub * 100)}`

  // Распознаём жанр по «Назначению платежа». Применяем regex'ы в порядке
  // от специфичного к общему.
  let genre = 'other'
  let merchantName = null
  let city = null
  let country = null
  let panMask = null
  let purposeData = null     // спец-данные для конкретного жанра

  // (1) Карточная операция
  const cardMatch = purposeText.match(PURPOSE_RES[0])
  if (cardMatch) {
    genre = 'card'
    merchantName = cardMatch[1].trim()
    // cardMatch[2] — address («STR IM PETROVA 29» / «UL. BUMMASHEVSKAYA D. 1»)
    // cardMatch[3] — city («Izhevsk» / «Yakshur-Bodya»)
    const fullAddr = cardMatch[2].trim()
    city = (cardMatch[3] || '').trim() || guessCityFromAddress(fullAddr)
    country = 'RU'
    panMask = `${cardMatch[5]}++++++${cardMatch[6]}`
    purposeData = { terminalId: null, originalDate: cardMatch[4] }
  } else if (PURPOSE_RES[1].test(purposeText)) {
    // (2) СБП
    genre = 'sbp'
  } else if (PURPOSE_RES[2].test(purposeText)) {
    // (3) Собственные средства
    genre = 'own'
  } else if (PURPOSE_RES[3].test(purposeText)) {
    // (4) QR
    const qrMatch = purposeText.match(PURPOSE_RES[3])
    genre = 'qr'
    purposeData = { qrId: qrMatch[1] }
  } else if (PURPOSE_RES[4].test(purposeText)) {
    // (5) Налог
    genre = 'tax'
  } else {
    genre = 'other'
  }

  // Определяем тип операции.
  // - 'own' (собственный перевод) → 'transfer'
  // - 'card' / 'sbp' / 'qr' / 'tax' / 'other':
  //     Исходящий → expense, Входящий → income
  let type
  if (genre === 'own') type = 'transfer'
  else if (direction === 'incoming') type = 'income'
  else type = 'expense'

  // Знак суммы: в выписке суммы положительные всегда. Для income/expense —
  // передаём абсолютную величину, бэкенд сам проставит знак по типу.
  // Для transfer — тоже положительная (бэкенд создаст 2 записи ±X).
  const amountKopecks = Math.round(amountRub * 100)

  // Recognition level.
  let recognitionLevel
  if (genre === 'card') recognitionLevel = 'full'
  else if (genre === 'own') recognitionLevel = 'partial'  // есть payer/payee, но не PAN/MCC
  else recognitionLevel = 'minimal'

  // MCC у Точки в CSV нет — null. confirmed всегда true (выписка = финальные).
  return {
    date: `${yyyy}-${mm}-${dd}`,
    originalDate: `${dd}.${mm}.${yyyy}`,
    externalRef,
    panMask,
    mcc: null,
    merchantName,
    terminalId: null,
    country,
    city,
    amount: amountKopecks,
    currency: 'RUB',
    description: purposeText,
    type,
    confirmed: true,
    recognitionLevel,

    // Поля специфичные для Точки — нужны UI (для отображения счёта плательщика /
    // получателя и для двух селектов в transfer-операциях).
    direction,
    payerName: get('payerName') || null,
    payeeName: get('payeeName') || null,
    payerAccount: get('payerAccount') || null,
    payeeAccount: get('payeeAccount') || null,
    payerInn: get('payerInn') || null,
    payeeInn: get('payeeInn') || null,
    payerBik: get('payerBik') || null,
    payeeBik: get('payeeBik') || null,
    docNumber: docNumber || null,
    purposeKind: genre,
    qrId: purposeData?.qrId || null
  }
}

// Адрес в выписке: «STR IM PETROVA 29,Izhevsk» / «UL. BUMMASHEVSKAYA D. 1,Izhevsk»
// / «STR PUSHINOY 127,Yakshur-Bodya». City = последний сегмент через запятую.
// Иногда бывает «STR PUSHINOY 127,Yakshur-Bodya,RU» — но в нашем regex «,RU»
// уже отрезан, поэтому просто split по запятой и берём последний непустой.
function guessCityFromAddress(addr) {
  if (!addr) return null
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean)
  // Последняя часть может быть «RU» если регулярка захватила лишнее; отсекаем.
  if (parts.length && parts[parts.length - 1] === 'RU') parts.pop()
  return parts.length ? parts[parts.length - 1] : null
}