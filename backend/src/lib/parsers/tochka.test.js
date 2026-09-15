// Детерминированная проверка парсера выписок Точка-Банка (CSV).
//
// Запуск:
//   node --test backend/src/lib/parsers/tochka.test.js
//
// Тест НЕ зависит от реального CSV-файла: фикстуры — синтетические строки
// в том виде, как их возвращает Точка (UTF-8 BOM, разделитель `;`, 42 колонки).
// Это позволяет проверять парсер в изоляции и в CI.
//
// Жанры:
//   1. card     — «Покупка товара(Терминал:...,карта 5140********2748)»
//   2. sbp      — «Перевод по номеру телефона … через СБП.»
//   3. own      — «Перевод собственных средств.»
//   4. qr       — «Списание по QR коду ID AD10000…»
//   5. tax      — «Налог, взимаемый в связи с применением УСН…»
//   6. other    — «Оплата по счету/акту/договору №…»

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTochkaStatement } from './tochka.js'

// =================================================================
// Хелпер: собирает CSV-строку из массива колонок. Колонки могут
// содержать `;`, кавычки и переносы — квотируем по правилам RFC 4180.
// В выписке Точки кавычки экранируются удвоением («ООО ""КСМ""»), а
// запятые внутри полей не квотируются — это не CSV по стандарту, но
// Точка так делает. Наш split(';') рассчитан именно на это.
// =================================================================
function makeRow(cols) {
  return cols.map(v => {
    const s = String(v ?? '')
    return s.includes(';') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')
}

// Минимальная шапка из 42 колонок, в порядке Точки. Если Точка его поменяет —
// парсер упадёт в первом call'е с понятной ошибкой (тест ниже это и проверяет).
const HEADER = [
  'Дата проводки', 'Дата документа', 'Дата списания', 'Дата зачисления', 'Номер документа',
  'Направление', 'Сумма операции', 'Сумма операции в рублях', 'Входящий остаток', 'Исходящий остаток',
  'Назначение платежа', 'Наименование плательщика', 'Счет плательщика', 'ИНН плательщика', 'КПП плательщика',
  'Бик банка плательщика', 'Наименование банка плательщика', 'Адрес банка плательщика', 'Корр. счёт банка плательщика',
  'Наименование получателя', 'Счет получателя', 'ИНН получателя', 'КПП получателя', 'Бик банка получателя',
  'Наименование банка получателя', 'Адрес банка получателя', 'Корр. счет банка получателя',
  'Курс конвертации', 'Сумма после конвертации', 'Приоритет', 'Тип документа', 'Бюджетный', 'Бюджетный: статус',
  'Бюджетный: КБК', 'Бюджетный: ОКАТО', 'Бюджетный: Основание', 'Бюджетный: Период', 'Бюджетный: Номер',
  'Бюджетный: дата', 'Бюджетный: тип', 'Основание списания', 'Код'
]

function buildCsv(rows, { bom = true } = {}) {
  const lines = [HEADER.join(';')].concat(rows.map(makeRow))
  return (bom ? '\uFEFF' : '') + lines.join('\n')
}

// =================================================================
// Жанр 1: карточная операция (Покупка товара).
// =================================================================
const CARD_ROW = [
  '01.01.2026', '01.01.2026', '01.01.2026', '', '558086',
  'Исходящий', '620,00', '620,00', '10000,21', '9380,21',
  'Покупка товара(Терминал:FRENSIS PETROVSKIJ,STR IM PETROVA 29,Izhevsk,RU,дата операции:30/12/2025 14:31(МСК),на сумму:620 RUB,карта 5140********2748)',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  '"ООО ""Банк Точка"""', '30232810520000075065', '9721194461', '997950001', '044525104',
  '"ООО ""Банк Точка"""', '"ООО ""Банк Точка"""', '30101810745374525104',
  '', '', '5', '17', '', '', '', '', '', '', '', '', '', '', ''
]

test('карточная операция: парсится в 1 запись', () => {
  const csv = buildCsv([CARD_ROW])
  const ops = parseTochkaStatement(csv)
  assert.equal(ops.length, 1)
})

test('карточная операция: дата в ISO + оригинал', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].date, '2026-01-01')
  assert.equal(ops[0].originalDate, '01.01.2026')
})

test('карточная операция: externalRef стабильный (Номер документа)', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].externalRef, 'tchk-doc-558086')
})

test('карточная операция: PAN-маска в формате банка', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].panMask, '5140++++++2748')
})

test('карточная операция: merchant + city + country извлекаются', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].merchantName, 'FRENSIS PETROVSKIJ')
  assert.equal(ops[0].city, 'Izhevsk')
  assert.equal(ops[0].country, 'RU')
})

test('карточная операция: MCC = null (Точка не отдаёт MCC)', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].mcc, null)
})

test('карточная операция: amount в копейках, type = expense', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].amount, 62000)
  assert.equal(ops[0].type, 'expense')
})

test('карточная операция: recognitionLevel = full', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].recognitionLevel, 'full')
})

test('карточная операция: payer/payee контрагенты заполнены', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.equal(ops[0].payerName, 'Индивидуальный предприниматель Говязин Сергей Николаевич')
  assert.equal(ops[0].payerAccount, '40802810901500113741')
  assert.equal(ops[0].payerInn, '182402257780')
})

// =================================================================
// Жанр 2: СБП-перевод (расход).
// =================================================================
const SBP_OUT_ROW = [
  '07.01.2026', '07.01.2026', '07.01.2026', '', '425301',
  'Исходящий', '500,00', '500,00', '7820,21', '7320,21',
  'Перевод по номеру телефона +7 952 409-60-61 Получатель Софья Александровна Д. через СБП.',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  '"ООО ""Банк Точка"""', '30232810920000000009', '9721194461', '997950001', '044525104',
  '"ООО ""Банк Точка"""', '"ООО ""Банк Точка"""', '30101810745374525104',
  '', '', '5', '17', '', '', '', '', '', '', '', '', '', '', ''
]

test('СБП исходящий: type = expense, amount положительный', () => {
  const ops = parseTochkaStatement(buildCsv([SBP_OUT_ROW]))
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'expense')
  assert.equal(ops[0].amount, 50000)
  assert.equal(ops[0].direction, 'outgoing')
})

test('СБП исходящий: recognitionLevel = minimal (нет PAN/MCC)', () => {
  const ops = parseTochkaStatement(buildCsv([SBP_OUT_ROW]))
  assert.equal(ops[0].recognitionLevel, 'minimal')
  assert.equal(ops[0].panMask, null)
  assert.equal(ops[0].mcc, null)
})

test('СБП входящий: type = income (доход от контрагента)', () => {
  const SBP_IN = [...SBP_OUT_ROW]
  SBP_IN[5] = 'Входящий'
  SBP_IN[10] = 'Перевод по номеру телефона +7 952 409-60-61 Отправитель Сергей Николаевич Г. через СБП.'
  const ops = parseTochkaStatement(buildCsv([SBP_IN]))
  assert.equal(ops[0].type, 'income')
  assert.equal(ops[0].direction, 'incoming')
})

// =================================================================
// Жанр 3: Перевод собственных средств (transfer).
// =================================================================
const OWN_TRANSFER_ROW = [
  '09.01.2026', '09.01.2026', '', '09.01.2026', '1',
  'Входящий', '6500,00', '6500,00', '5670,21', '12170,21',
  'Перевод собственных средств. Без НДС.',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810701500252611', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', '"ООО ""Банк Точка"""', '30101810745374525104',
  '', '', '5', '01', '', '', '', '', '', '', '', '', '', '', ''
]

test('own transfer: type = transfer (НЕ income/expense)', () => {
  const ops = parseTochkaStatement(buildCsv([OWN_TRANSFER_ROW]))
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'transfer')
})

test('own transfer: payerAccount != payeeAccount (это перемещение, не доход)', () => {
  const ops = parseTochkaStatement(buildCsv([OWN_TRANSFER_ROW]))
  assert.equal(ops[0].payerAccount, '40802810701500252611')
  assert.equal(ops[0].payeeAccount, '40802810901500113741')
})

test('own transfer: amount положительный (бэкенд сам сделает ±)', () => {
  const ops = parseTochkaStatement(buildCsv([OWN_TRANSFER_ROW]))
  assert.equal(ops[0].amount, 650000)
})

test('own transfer: recognitionLevel = partial (есть payer/payee, но не PAN/MCC)', () => {
  const ops = parseTochkaStatement(buildCsv([OWN_TRANSFER_ROW]))
  assert.equal(ops[0].recognitionLevel, 'partial')
})

// =================================================================
// Жанр 4: QR-списание.
// =================================================================
const QR_ROW = [
  '20.06.2026', '20.06.2026', '20.06.2026', '', '777111',
  'Исходящий', '500,00', '500,00', '9000,00', '8500,00',
  'Списание по QR коду ID AD10000D5X1F в Тинькофф',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  'Тинькофф Банк', '30232810100000000001', '7710140679', '0', '044525104',
  'Тинькофф Банк', 'Тинькофф Банк', '30101810145250000451',
  '', '', '5', '17', '', '', '', '', '', '', '', '', '', '', ''
]

test('QR: type = expense, qrId извлекается', () => {
  const ops = parseTochkaStatement(buildCsv([QR_ROW]))
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'expense')
  assert.equal(ops[0].qrId, 'AD10000D5X1F')
  assert.equal(ops[0].purposeKind, 'qr')
})

// =================================================================
// Жанр 5: налог (УСН).
// =================================================================
const TAX_ROW = [
  '25.07.2026', '25.07.2026', '25.07.2026', '', '888222',
  'Исходящий', '4500,00', '4500,00', '30000,00', '25500,00',
  'Налог, взимаемый в связи с применением УСН. Без НДС.',
  'Индивидуальный предприниматель Говязин Сергей Николаевич', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  'УФК по Тульской области', '40102810445370000066', '7727088603', '0', '017003983',
  'УФК по Тульской области', 'УФК по Тульской области', '30101810445370000066',
  '', '', '5', '01', '', '', '', '', '', '', '', '', '', '', ''
]

test('налог: type = expense, purposeKind = tax', () => {
  const ops = parseTochkaStatement(buildCsv([TAX_ROW]))
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'expense')
  assert.equal(ops[0].purposeKind, 'tax')
})

// =================================================================
// Жанр 6: оплата по счёту (other, income при входящем).
// =================================================================
const INVOICE_INCOMING = [
  '13.01.2026', '13.01.2026', '', '13.01.2026', '9',
  'Входящий', '23000,00', '23000,00', '5140,21', '28140,21',
  'Оплата по акту об оказании услуг №25 от 29 декабря 2025, Без налога (НДС)',
  '"ООО ""КСМ"""', '40702810303270003423', '7810442063', '781001001', '044525104',
  '"ООО ""Банк Точка"""', 'г. Москва', '30101810745374525104',
  'ИП ГОВЯЗИН СЕРГЕЙ НИКОЛАЕВИЧ', '40802810901500113741', '182402257780', '0', '044525104',
  '"ООО ""Банк Точка"""', '"ООО ""Банк Точка"""', '30101810745374525104',
  '', '', '5', '01', '', '', '', '', '', '', '', '', '', '', ''
]

test('оплата по акту входящая: type = income, purposeKind = other', () => {
  const ops = parseTochkaStatement(buildCsv([INVOICE_INCOMING]))
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'income')
  assert.equal(ops[0].amount, 2300000)
  assert.equal(ops[0].purposeKind, 'other')
})

// =================================================================
// BOM, пустой ввод, шапка без нужных колонок.
// =================================================================

test('BOM: с BOM или без — одинаковый результат', () => {
  const csvWithBom = buildCsv([CARD_ROW], { bom: true })
  const csvWithout = buildCsv([CARD_ROW], { bom: false })
  assert.deepEqual(parseTochkaStatement(csvWithBom), parseTochkaStatement(csvWithout))
})

test('пустой ввод → пустой массив', () => {
  assert.deepEqual(parseTochkaStatement(''), [])
  assert.deepEqual(parseTochkaStatement('   '), [])
  assert.deepEqual(parseTochkaStatement('\uFEFF'), [])
})

test('только шапка → пустой массив', () => {
  const csv = '\uFEFF' + HEADER.join(';')
  assert.deepEqual(parseTochkaStatement(csv), [])
})

test('шапка без обязательной колонки → понятная ошибка', () => {
  const badHeader = HEADER.slice(1).join(';')  // убрали первую колонку
  const csv = '\uFEFF' + badHeader + '\n' + makeRow(CARD_ROW)
  assert.throws(
    () => parseTochkaStatement(csv),
    /header не содержит колонку «Дата проводки»/
  )
})

test('строка без даты — пропускается (не падает)', () => {
  const noDate = [...CARD_ROW]
  noDate[0] = ''  // нет даты проводки
  noDate[1] = ''  // нет даты документа
  const ops = parseTochkaStatement(buildCsv([noDate]))
  assert.deepEqual(ops, [])
})

test('строка с пустой суммой — пропускается', () => {
  const noAmount = [...CARD_ROW]
  noAmount[6] = ''   // Сумма операции
  noAmount[7] = ''   // Сумма операции в рублях
  const ops = parseTochkaStatement(buildCsv([noAmount]))
  assert.deepEqual(ops, [])
})

test('externalRef уникален в пределах выписки (разные docNumber)', () => {
  const row2 = [...CARD_ROW]
  row2[4] = '559999'  // Номер документа (idx=4)
  const ops = parseTochkaStatement(buildCsv([CARD_ROW, row2]))
  assert.equal(ops.length, 2)
  assert.notEqual(ops[0].externalRef, ops[1].externalRef)
})

test('mixed: card + sbp + own + qr в одной выписке', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW, SBP_OUT_ROW, OWN_TRANSFER_ROW, QR_ROW]))
  assert.equal(ops.length, 4)
  assert.equal(ops[0].purposeKind, 'card')
  assert.equal(ops[1].purposeKind, 'sbp')
  assert.equal(ops[2].purposeKind, 'own')
  assert.equal(ops[3].purposeKind, 'qr')
})

test('summary в комментарии не теряются', () => {
  const ops = parseTochkaStatement(buildCsv([CARD_ROW]))
  assert.match(ops[0].description, /Покупка товара/)
  assert.match(ops[0].description, /FRENSIS PETROVSKIJ/)
})