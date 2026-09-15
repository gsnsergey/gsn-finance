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