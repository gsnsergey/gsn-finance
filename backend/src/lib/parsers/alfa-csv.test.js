// Детерминированная проверка парсера CSV-выписок Альфа-Банка.
//
// Запуск:
//   node --test backend/src/lib/parsers/alfa-csv.test.js
//
// Фикстура синтетическая, но повторяет реальные особенности выписки Альфы:
//   - UTF-8 BOM в начале;
//   - квотированные поля с запятыми внутри (категория «Связь, интернет и ТВ»);
//   - пустые колонки (не все операции карточные);
//   - суммы с точкой-разделителем и без знака (знак в колонке type);
//   - переводы между своими счетами парой Списание/Пополнение.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAlfaCsvStatement, OWN_TRANSFER_CATEGORY } from './alfa-csv.js'

const HEADER = [
  'operationDate', 'transactionDate', 'accountName', 'accountNumber', 'cardName', 'cardNumber',
  'merchant', 'amount', 'currency', 'status', 'category', 'mcc', 'type', 'comment', 'bonusValue', 'bonusTitle'
]

// Квотируем поле, если внутри есть запятая/кавычка/перенос строки (RFC 4180).
function cell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(rows, { bom = true } = {}) {
  const lines = [HEADER.join(',')].concat(rows.map(r => r.map(cell).join(',')))
  return (bom ? '\uFEFF' : '') + lines.join('\n')
}

const CARD_ROW = [
  '14.09.2026', '', 'Текущий счёт', '40817810505974389734', 'Виртуальная карта для погашения пот',
  '220015******4795', 'Krasnodar/MAGNIT DOSTAVKA_YM', '1315.53', 'RUR', 'В обработке',
  'Продукты', '5411', 'Списание', '', '', ''
]

const COMMA_ROW = [
  '08.03.2026', '08.03.2026', 'Текущий счёт', '40817810505974389734', '', '',
  'МТС', '900', 'RUR', 'Выполнен', 'Связь, интернет и ТВ', '', 'Списание', '', '', ''
]

const INCOME_ROW = [
  '02.09.2026', '02.09.2026', 'Текущий счёт', '40817810608690110883', '', '',
  'Сергей Г.', '30000', 'RUR', '', 'Переводы', '', 'Пополнение', '', '', ''
]

const OWN_IN_ROW = [
  '02.09.2026', '02.09.2026', 'Текущий счёт', '40817810505974389734', '', '',
  'Между своими счетами', '30000', 'RUR', '', OWN_TRANSFER_CATEGORY, '', 'Пополнение', '', '', ''
]

const OWN_OUT_ROW = [
  '02.09.2026', '02.09.2026', 'Текущий счёт', '40817810608690110883', '', '',
  'Между своими счетами', '30000', 'RUR', 'Выполнен', OWN_TRANSFER_CATEGORY, '', 'Списание', '', '', ''
]

const BACKSLASH_ROW = [
  '05.09.2026', '05.09.2026', 'Текущий счёт', '40817810505974389734', '', '220015******4831',
  'Izhevsk\\MAGNIT MM EPIZOD', '250.00', 'RUR', 'Выполнен', 'Продукты', '5411', 'Списание', '', '', ''
]

const FIXTURE = buildCsv([CARD_ROW, COMMA_ROW, INCOME_ROW, OWN_IN_ROW, OWN_OUT_ROW, BACKSLASH_ROW])

test('парсит все строки и пропускает только шапку', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops.length, 6)
})

test('дата операции → ISO + originalDate, transactionDate отдельно', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].date, '2026-09-14')
  assert.equal(ops[0].originalDate, '14.09.2026')
  assert.equal(ops[0].transactionDate, null)   // пустая колонка
  assert.equal(ops[1].transactionDate, '2026-03-08')
})

test('сумма в копейках со знаком из колонки type (нет знака в CSV)', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].type, 'expense')
  assert.equal(ops[0].amount, -131553)        // 1315.53 ₽
  assert.equal(ops[1].amount, -90000)         // 900 ₽
  assert.equal(ops[2].type, 'income')
  assert.equal(ops[2].amount, 3000000)        // 30 000 ₽
})

test('маска карты: `*` нормализуется в `+` как в account_cards', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].panMask, '220015++++++4795')
  assert.equal(ops[5].panMask, '220015++++++4831')
  // у операции без карты маски нет
  assert.equal(ops[1].panMask, null)
})

test('MCC извлекается, у некарточных операций = null', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].mcc, '5411')
  assert.equal(ops[1].mcc, null)
  assert.equal(ops[2].mcc, null)
})

test('merchant разделяется на city и merchantName (и «/», и «\\»)', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].merchantName, 'MAGNIT DOSTAVKA_YM')
  assert.equal(ops[0].city, 'Krasnodar')
  assert.equal(ops[0].country, 'RU')
  assert.equal(ops[5].merchantName, 'MAGNIT MM EPIZOD')
  assert.equal(ops[5].city, 'Izhevsk')
  // без разделителя — merchantName целиком, city = null
  assert.equal(ops[1].merchantName, 'МТС')
  assert.equal(ops[1].city, null)
  assert.equal(ops[1].country, null)
})

test('квотированное поле с запятой не ломает разбор колонок', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[1].bankCategory, 'Связь, интернет и ТВ')
  assert.equal(ops[1].type, 'expense')
})

test('статус «В обработке» → confirmed=false, иначе true', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].status, 'В обработке')
  assert.equal(ops[0].confirmed, false)
  assert.equal(ops[1].confirmed, true)
  assert.equal(ops[2].confirmed, true)   // пустой статус у поступлений
})

test('переводы между своими счетами помечаются isOwnTransfer', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[3].isOwnTransfer, true)
  assert.equal(ops[4].isOwnTransfer, true)
  assert.equal(ops[0].isOwnTransfer, false)
  assert.equal(ops[2].isOwnTransfer, false)
})

test('recognitionLevel: карта+MCC → full, только MCC/карта → partial, иначе minimal', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  assert.equal(ops[0].recognitionLevel, 'full')
  assert.equal(ops[1].recognitionLevel, 'minimal')
  assert.equal(ops[2].recognitionLevel, 'minimal')
})

test('externalRef детерминирован и уникален в пределах выписки', () => {
  const a = parseAlfaCsvStatement(FIXTURE)
  const b = parseAlfaCsvStatement(FIXTURE)
  assert.deepEqual(a.map(o => o.externalRef), b.map(o => o.externalRef))
  const refs = new Set(a.map(o => o.externalRef))
  assert.equal(refs.size, a.length, 'externalRef должны быть уникальны')
  for (const ref of refs) assert.match(ref, /^alfacsv-/)
})

test('одинаковые строки получают разные externalRef (суффикс -2)', () => {
  const dup = buildCsv([COMMA_ROW, COMMA_ROW])
  const ops = parseAlfaCsvStatement(dup)
  assert.equal(ops.length, 2)
  assert.notEqual(ops[0].externalRef, ops[1].externalRef)
  assert.ok(ops[1].externalRef.endsWith('-2'))
})

test('BOM и пустой/мусорный ввод', () => {
  assert.equal(parseAlfaCsvStatement('\uFEFF' + FIXTURE).length, 6)
  assert.deepEqual(parseAlfaCsvStatement(''), [])
  assert.deepEqual(parseAlfaCsvStatement('   \n\n '), [])
})

test('шапка без обязательной колонки → понятная ошибка', () => {
  const bad = 'operationDate,accountNumber,amount,type\n14.09.2026,40817810505974389734,1315.53,Списание'
  assert.throws(() => parseAlfaCsvStatement(bad), /header не содержит/i)
})

test('строка без даты или без известного типа пропускается', () => {
  const rows = [
    ['', '', 'Текущий счёт', '40817810505974389734', '', '', 'X', '10', 'RUR', '', '', '', 'Списание', '', '', ''],
    ['01.01.2026', '', 'Текущий счёт', '40817810505974389734', '', '', 'X', '10', 'RUR', '', '', '', 'Неизвестно', '', '', '']
  ]
  assert.deepEqual(parseAlfaCsvStatement(buildCsv(rows)), [])
})

test('валюта берётся из колонки (RUR по умолчанию)', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  for (const op of ops) assert.equal(op.currency, 'RUR')
})

test('rawSource сохраняет исходную строку CSV (кнопка «исходные данные»)', () => {
  const ops = parseAlfaCsvStatement(FIXTURE)
  const card = ops.find(o => o.mcc === '5411' && o.panMask === '220015++++++4795')
  assert.ok(card.rawSource.startsWith('14.09.2026,'), 'строка начинается с даты операции')
  assert.ok(card.rawSource.includes('Krasnodar/MAGNIT DOSTAVKA_YM'))
  // Квотированное поле с запятой внутри не рвёт исходную строку.
  const comma = ops.find(o => o.merchantName === 'МТС')
  assert.ok(comma.rawSource.includes('"Связь, интернет и ТВ"'))
})
