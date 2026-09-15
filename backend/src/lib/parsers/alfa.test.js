// Детерминированная проверка парсера выписок Альфа-Банка.
//
// Запуск:
//   node --test backend/src/lib/parsers/alfa.test.js
//
// Тест НЕ зависит от реального PDF: фикстура — синтетический текст
// в том виде, как его вернёт pdf-parse (схлопнутые пробелы, переносы \n).
// Это позволяет проверять парсер в изоляции и в CI.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAlfaStatement } from './alfa.js'

// Текст «как из pdf-parse»: построчно, пробелы одиночные.
// Каждая операция — 3 логических строки (проводка / merchant / сумма),
// но в исходнике длинная строка «проводки» может быть свёрнута в одну
// (после нормализации \s+ → ' ' внутри блока).
//
// String.raw: бэкслеши в тексте выписки одиночные (\RU), а JS-движок
// интерпретирует \R и \U как обычные символы внутри template literal,
// поэтому без String.raw они удваивались бы и регулярка merchantRe
// (\d+\\…) не находила бы совпадений.
const FIXTURE = String.raw`ВЫПИСКА ПО СЧЁТУ
Период: 12.11.2025 — 14.11.2025
Счёт: 40817***0123 RUB

12.11.2025  CRD_9643H4  Операция по карте: 220015++++++4795, на сумму: 35.00 RUR, дата совершения 11.11.2025
                  32410885\RU\MOSCOW\DOSTAVKA IZ PYATEROCH MCC5411
                                                        -35,00 RUR
13.11.2025  CRD_9644A1  Операция по карте: 220015++++++4795, на сумму: 250.00 RUR, дата совершения 12.11.2025
                  32410886\RU\MOSCOW\KVARTAL MCC5812
                                                        -250,00 RUR
14.11.2025  CRD_9645B2  Операция по карте: 220015++++++4795, на сумму: 1500.00 RUR, дата совершения 13.11.2025
                  32410887\RU\MOSCOW\TATNEFT AZS 611 MCC5541
                                                        -1500,00 RUR
15.11.2025  CRD_9646C3  Перевод на счёт: 220015++++++4795, на сумму: 5000.00 RUR
                  99999\RU\MOSCOW\SBER BANK ONL MCC4829
                                                        +5000,00 RUR

ИТОГО РАСХОДОВ: 1785,00 RUR
ИТОГО ПРИХОДОВ: 5000,00 RUR`

test('парсит 4 операции, пропускает шапку/итоги', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops.length, 4, 'должно быть ровно 4 операции')
})

test('извлекает дату в ISO и сохраняет оригинал', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].date, '2025-11-12')
  assert.equal(ops[0].originalDate, '12.11.2025')
  assert.equal(ops[1].date, '2025-11-13')
  assert.equal(ops[3].date, '2025-11-15')
})

test('извлекает код операции (externalRef для transactions)', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].externalRef, 'CRD_9643H4')
  assert.equal(ops[1].externalRef, 'CRD_9644A1')
  assert.equal(ops[3].externalRef, 'CRD_9646C3')
})

test('извлекает маску карты в формате Альфы', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].panMask, '220015++++++4795')
})

test('извлекает MCC как строку из 4 цифр', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].mcc, '5411')
  assert.equal(ops[1].mcc, '5812')
  assert.equal(ops[2].mcc, '5541')
  assert.equal(ops[3].mcc, '4829')
})

test('извлекает merchantName / terminalId / country / city', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].merchantName, 'DOSTAVKA IZ PYATEROCH')
  assert.equal(ops[0].terminalId, '32410885')
  assert.equal(ops[0].country, 'RU')
  assert.equal(ops[0].city, 'MOSCOW')
  assert.equal(ops[2].merchantName, 'TATNEFT AZS 611')
})

test('конвертирует сумму в копейки со знаком', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].amount, -3500)    // -35,00 RUR
  assert.equal(ops[1].amount, -25000)   // -250,00 RUR
  assert.equal(ops[2].amount, -150000)  // -1500,00 RUR
  assert.equal(ops[3].amount, 500000)   // +5000,00 RUR
})

test('определяет тип по знаку суммы (income / expense)', () => {
  const ops = parseAlfaStatement(FIXTURE)
  assert.equal(ops[0].type, 'expense')
  assert.equal(ops[1].type, 'expense')
  assert.equal(ops[2].type, 'expense')
  assert.equal(ops[3].type, 'income')
})

test('currency всегда RUR (Альфа выписки рублёвые)', () => {
  const ops = parseAlfaStatement(FIXTURE)
  for (const op of ops) assert.equal(op.currency, 'RUR')
})

test('пустой/мусорный текст → пустой массив', () => {
  assert.deepEqual(parseAlfaStatement(''), [])
  assert.deepEqual(parseAlfaStatement('   \n\n  '), [])
  assert.deepEqual(parseAlfaStatement('нет ни дат ни кодов'), [])
})

test('шапочные и финальные строки выписки не парсятся как операции', () => {
  // Случай: строка с датой в начале, но без CRD_xxxxxx и без маски — отбрасывается.
  const noise = `12.11.2025  Заголовок выписки, без кода операции
Итого по счёту: 5000,00 RUR`
  assert.deepEqual(parseAlfaStatement(noise), [])
})

// =================================================================
// HOLD-операции (неподтверждённые резервы).
//
// Это отдельный жанр строк в выписке Альфы: в первой колонке вместо даты
// стоит «HOLD», а дата операции — внутри текста. Парсер должен:
//   1. Распознать «HOLD» как начало нового блока (иначе HOLD-строки
//      склеиваются с предыдущей обычной операцией и порождают мусорные
//      записи в transactions — баг, пойманный 2026-09-15).
//   2. Извлечь дату из фразы «дата операции: DD.MM.YYYY».
//   3. Извлечь ID операции из «Неподтвержденная операция: <ID>».
//   4. mcc = null.
//   5. confirmed = false.
// =================================================================

const HOLD_FIXTURE = String.raw`08.09.2026  CRD_2W0124  Операция по карте: 220015++++++4795, на сумму: 216.97 RUR, дата совершения операции: 05.09.26, место совершения операции:
                  24004803\RU\Yagul\PYATEROCHKA 21436 (MP-4001) MCC5411
                                                        -216,97 RUR
HOLD  Неподтвержденная операция: 9BB7W3 31875356 RU MAGNIT DOSTAVKA_YM>Kras13.09.26 13.09.26 1368.89 RUR 220015++++++4795, дата операции: 13.09.2026, дата предполагаемого снятия блокировки: 22.09.2026
                  Сумма, зарезервированная для погашения: 0.00
                                                        -1 368,89 RUR
HOLD  Неподтвержденная операция: 82Z60Z 31875356 RU MAGNIT DOSTAVKA_YM>Kras14.09.26 14.09.26 1315.53 RUR 220015++++++4795, дата операции: 14.09.2026, дата предполагаемого снятия блокировки: 23.09.2026
                  Сумма, зарезервированная для погашения: 0.00
                                                        -1 315,53 RUR`

test('HOLD: парсит 3 операции (1 обычная + 2 HOLD), не склеивает', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  assert.equal(ops.length, 3, 'должно быть 3 операции (1 обычная + 2 HOLD), а не 1 или 2')
})

test('HOLD: обычная операция сохраняет дату слева', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  assert.equal(ops[0].date, '2026-09-08')
  assert.equal(ops[0].externalRef, 'CRD_2W0124')
  assert.equal(ops[0].mcc, '5411')
  assert.equal(ops[0].confirmed, true)
})

test('HOLD: первая HOLD-операция получает дату из «дата операции:», не из предыдущей строки', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  // 9BB7W3 — дата операции 13.09.2026. Если бы парсер склеил с CRD_2W0124
  // (08.09), мы получили бы date=2026-09-08 + amount=1368.89 → мусорная запись.
  assert.equal(ops[1].date, '2026-09-13')
  assert.equal(ops[1].externalRef, '9BB7W3')
  assert.equal(ops[1].mcc, null, 'HOLD-операции не имеют MCC')
  assert.equal(ops[1].confirmed, false)
})

test('HOLD: вторая HOLD-операция получает свою дату 14.09, не путается с предыдущей', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  assert.equal(ops[2].date, '2026-09-14')
  assert.equal(ops[2].externalRef, '82Z60Z')
  assert.equal(ops[2].amount, -131553)
  assert.equal(ops[2].confirmed, false)
})

test('HOLD: суммы корректные, нет «склейки» последней суммы с чужой датой', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  assert.equal(ops[0].amount, -21697)  // -216,97 RUR
  assert.equal(ops[1].amount, -136889) // -1 368,89 RUR
  assert.equal(ops[2].amount, -131553) // -1 315,53 RUR
})

test('HOLD: merchant извлекается (MAGNIT DOSTAVKA_YM)', () => {
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  assert.equal(ops[1].merchantName, 'MAGNIT DOSTAVKA_YM')
  assert.equal(ops[1].city, 'Kras')
  assert.equal(ops[1].country, 'RU')
  assert.equal(ops[1].terminalId, '31875356')
})

test('HOLD: каждая HOLD-операция пишется в БД с правильным externalRef (дедуп)', () => {
  // Проверка регрессии: если бы парсер склеил, все три операции имели бы
  // один externalRef (CRD_2W0124), и повторный импорт тех же HOLD-блоков
  // считался бы дублем.
  const ops = parseAlfaStatement(HOLD_FIXTURE)
  const refs = new Set(ops.map(o => o.externalRef))
  assert.equal(refs.size, 3, 'externalRef должны быть разными у всех 3 операций')
})