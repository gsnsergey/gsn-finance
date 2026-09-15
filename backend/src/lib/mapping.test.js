// Детерминированная проверка маппинга import_rules → категория.
// Тесты для чистой функции suggestCategory (без БД).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestCategory } from './mapping.js'

// Универсальная операция-фикстура: одна и та же для всех тестов, если не
// нужно подменить поля.
const OP = {
  mcc: '5411',
  merchantName: 'DOSTAVKA IZ PYATEROCH',
  terminalId: '32410885',
  description: '12.11.2025 Операция по карте 220015++++++4795 на сумму 35.00 RUR DOSTAVKA IZ PYATEROCH MCC5411'
}

const CAT_PRODUKTY = 'cat-produktu'
const CAT_RESTORANY = 'cat-restorany'

test('матч по MCC → возвращает категорию', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'mcc', matchValue: '5411', categoryId: CAT_PRODUKTY, priority: 100 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.categoryId, CAT_PRODUKTY)
  assert.equal(result.rule.id, 'r1')
})

test('матч по merchantName (case-insensitive)', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'merchantName', matchValue: 'DOSTAVKA IZ PYATEROCH', categoryId: CAT_PRODUKTY, priority: 10 },
    { id: 'r2', accountId: null, matchType: 'mcc', matchValue: '5411', categoryId: CAT_RESTORANY, priority: 100 }
  ]
  const result = suggestCategory(OP, rules)
  // merchantName-priority=10 < mcc-priority=100 → merchantName выигрывает
  assert.equal(result.categoryId, CAT_PRODUKTY)
  assert.equal(result.rule.id, 'r1')
})

test('matchValue и merchantName сравниваются после .trim().toLowerCase()', () => {
  // В правилах может быть написано «DoStAvKa iz pyateroch», в операции —
  // «DOSTAVKA IZ PYATEROCH». Это должно совпасть.
  const rules = [
    { id: 'r1', accountId: null, matchType: 'merchantName', matchValue: '  DoStAvKa iz pyateroch ', categoryId: CAT_PRODUKTY, priority: 10 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.categoryId, CAT_PRODUKTY)
})

test('descriptionRegex: RegExp по описанию', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'descriptionRegex', matchValue: 'PYATEROCH', categoryId: CAT_PRODUKTY, priority: 200 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.categoryId, CAT_PRODUKTY)
})

test('descriptionRegex: битый regex не падает, правило пропускается', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'descriptionRegex', matchValue: '[unclosed', categoryId: CAT_PRODUKTY, priority: 200 },
    { id: 'r2', accountId: null, matchType: 'mcc', matchValue: '5411', categoryId: CAT_RESTORANY, priority: 100 }
  ]
  const result = suggestCategory(OP, rules)
  // r1 сломан → пропущен → r2 (mcc 5411) совпал → CAT_RESTORANY
  assert.equal(result.categoryId, CAT_RESTORANY)
  assert.equal(result.rule.id, 'r2')
})

test('matchType=merchantId матчится по terminalId', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'merchantId', matchValue: '32410885', categoryId: CAT_PRODUKTY, priority: 10 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.categoryId, CAT_PRODUKTY)
})

test('нет правил → null', () => {
  assert.equal(suggestCategory(OP, []), null)
})

test('нет совпадений → null', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'mcc', matchValue: '5812', categoryId: CAT_RESTORANY, priority: 100 },
    { id: 'r2', accountId: null, matchType: 'merchantName', matchValue: 'KVARTAL', categoryId: CAT_RESTORANY, priority: 100 }
  ]
  assert.equal(suggestCategory(OP, rules), null)
})

test('неизвестный matchType не падает (защита от мусора в БД)', () => {
  const rules = [
    { id: 'r1', accountId: null, matchType: 'whatever', matchValue: 'X', categoryId: CAT_PRODUKTY, priority: 10 },
    { id: 'r2', accountId: null, matchType: 'mcc', matchValue: '5411', categoryId: CAT_RESTORANY, priority: 100 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.categoryId, CAT_RESTORANY)
})

test('правила применяются в порядке priority ASC: меньше число → первый', () => {
  // В production порядок гарантирует loadRules() через SQL ORDER BY priority ASC.
  // Здесь мы явно передаём отсортированный массив, как сделал бы loadRules.
  // merchantName priority=200 (плохо), mcc priority=100 (хорошо) — mcc выигрывает.
  const rules = [
    { id: 'mcc', accountId: null, matchType: 'mcc', matchValue: '5411', categoryId: CAT_RESTORANY, priority: 100 },
    { id: 'mname', accountId: null, matchType: 'merchantName', matchValue: 'DOSTAVKA IZ PYATEROCH', categoryId: CAT_PRODUKTY, priority: 200 }
  ]
  const result = suggestCategory(OP, rules)
  assert.equal(result.rule.id, 'mcc')
  assert.equal(result.categoryId, CAT_RESTORANY)
})