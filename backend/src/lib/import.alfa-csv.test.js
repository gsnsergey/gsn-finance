// Интеграционная проверка preview CSV-выписки Альфа-Банка
// (buildAlfaCsvPreview): резолв счёта, склейка переводов между своими
// счетами, подстановка категорий и дедуп по externalRef.
//
// Запуск:
//   node --test backend/src/lib/import.alfa-csv.test.js
//
// Изоляция: FINANS_DB указывает на временную БД, поэтому рабочий
// data/finans.db не читается и не пишется. import.js подтягивает db.js,
// который читает FINANS_DB на старте — поэтому env выставляется ДО
// динамического импорта (db.js нельзя импортировать статически).
// Парсер alfa-csv.js от db.js не зависит и импортируется статически.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { parseAlfaCsvStatement } from './parsers/alfa-csv.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finans-alfa-csv-'))
const dbPath = path.join(tmpDir, 'test.db')
process.env.FINANS_DB = dbPath

// --- схема (минимально достаточная для preview) -----------------------------
const seed = new Database(dbPath)
seed.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY, name TEXT, bank TEXT, accountNumber TEXT, archived INTEGER DEFAULT 0
  );
  CREATE TABLE account_cards (
    id TEXT PRIMARY KEY, accountId TEXT, panMask TEXT, label TEXT
  );
  CREATE TABLE categories (
    id TEXT PRIMARY KEY, name TEXT, archived INTEGER DEFAULT 0
  );
  CREATE TABLE import_rules (
    id TEXT PRIMARY KEY, accountId TEXT, matchType TEXT, matchValue TEXT,
    categoryId TEXT, priority INTEGER
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, accountId TEXT, externalRef TEXT
  );
  INSERT INTO categories (id, name, archived) VALUES
    ('cat-prod', 'Продукты', 0),
    ('cat-transfers', 'Переводы', 0);
  INSERT INTO accounts (id, name, bank, accountNumber, archived) VALUES
    ('acc-alfa1', 'Альфа (На продукты)', 'alfa', '40817810505974389734', 0),
    ('acc-alfa2', 'Альфа (Текущий)', 'alfa', '40817810608690110883', 0),
    ('acc-tochka', 'Точка (GSN)', 'tochka', '40802810901500113741', 0);
  INSERT INTO account_cards (id, accountId, panMask, label) VALUES
    ('card-1', 'acc-alfa1', '220015++++++4795', NULL);
  INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority) VALUES
    ('rule-1', NULL, 'mcc', '5411', 'cat-prod', 100);
`)
seed.close()

// import.js тянет db.js, который читает FINANS_DB — поэтому динамический импорт
// после установки env. Рабочая data/finans.db не затрагивается.
const { buildAlfaCsvPreview } = await import('./import.js')
const db = new Database(dbPath)

// --- фикстура ---------------------------------------------------------------
const HEADER = 'operationDate,transactionDate,accountName,accountNumber,cardName,cardNumber,merchant,amount,currency,status,category,mcc,type,comment,bonusValue,bonusTitle'
const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csv = rows => '\uFEFF' + [HEADER].concat(rows.map(r => r.map(q).join(','))).join('\n')

const CARD = ['10.09.2026', '10.09.2026', 'Текущий счёт', '40817810505974389734', 'Карта', '220015******4795', 'Krasnodar/MAGNIT', '100.00', 'RUR', 'Выполнен', 'Прочее', '5411', 'Списание', '', '', '']
const INCOME = ['02.09.2026', '02.09.2026', 'Текущий счёт', '40817810608690110883', '', '', 'Сергей Г.', '30000', 'RUR', '', 'Переводы', '', 'Пополнение', '', '', '']
const OWN_IN = ['02.09.2026', '02.09.2026', 'Текущий счёт', '40817810505974389734', '', '', 'Между своими счетами', '30000', 'RUR', '', 'Между своими счетами', '', 'Пополнение', '', '', '']
const OWN_OUT = ['02.09.2026', '02.09.2026', 'Текущий счёт', '40817810608690110883', '', '', 'Между своими счетами', '30000', 'RUR', 'Выполнен', 'Между своими счетами', '', 'Списание', '', '', '']
const FALLBACK = ['03.09.2026', '03.09.2026', 'Текущий счёт', '40817810505974389734', '', '', 'Пятёрочка', '500', 'RUR', 'Выполнен', 'Продукты', '', 'Списание', '', '', '']
const UNKNOWN = ['04.09.2026', '04.09.2026', 'Текущий счёт', '99999999999999999999', '', '', 'X', '10', 'RUR', 'Выполнен', 'Прочее', '', 'Списание', '', '', '']

const FIXTURE = csv([CARD, INCOME, OWN_IN, OWN_OUT, FALLBACK, UNKNOWN])

function previewFixture() {
  return buildAlfaCsvPreview(parseAlfaCsvStatement(FIXTURE), db)
}

function firstOp(date) {
  // date передаётся в формате выписки DD.MM.YYYY, а preview отдаёт ISO.
  const iso = date.replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, '$3-$2-$1')
  const op = previewFixture().operations.find(o => o.date === iso && o.type !== 'transfer')
  assert.ok(op, `нет операции на ${date}`)
  return op
}

test('preview: totals и склейка перевода между своими счетами', () => {
  const preview = previewFixture()
  assert.equal(preview.totals.found, 5)              // 6 строк − 2 строки перевода + 1 transfer
  assert.equal(preview.totals.transferCount, 1)
  assert.equal(preview.totals.unresolvedAccount, 1)  // UNKNOWN без счёта
  assert.equal(preview.totals.alreadyImported, 0)

  const transfer = preview.operations.find(o => o.type === 'transfer')
  assert.ok(transfer, 'должен быть transfer')
  assert.equal(transfer.amount, 3000000)
  assert.equal(transfer.resolvedAccountId, 'acc-alfa2')       // источник (Списание)
  assert.equal(transfer.transferAccountId, 'acc-alfa1')       // получатель (Пополнение)
  assert.match(transfer.externalRef, /^alfacsv-transfer-/)
})

test('preview: счёт резолвится по номеру р/с', () => {
  assert.equal(firstOp('10.09.2026').resolvedAccountId, 'acc-alfa1')
  assert.equal(firstOp('04.09.2026').resolvedAccountId, null)
})

test('preview: счёт резолвится по маске карты, если номера нет', () => {
  const row = [...CARD]
  row[3] = ''      // accountNumber пуст
  const ops = parseAlfaCsvStatement(csv([row]))
  const op = buildAlfaCsvPreview(ops, db).operations[0]
  assert.equal(op.resolvedAccountId, 'acc-alfa1')
})

test('preview: категория по правилу MCC имеет приоритет и помечается matchedRule', () => {
  const op = firstOp('10.09.2026')
  assert.equal(op.suggestedCategoryId, 'cat-prod')
  assert.ok(op.matchedRule)
  assert.equal(op.matchedRule.matchType, 'mcc')
})

test('preview: категория банка используется как дефолт без правила', () => {
  const op = firstOp('03.09.2026')
  assert.equal(op.suggestedCategoryId, 'cat-prod')   // «Продукты» → cat-prod по имени
  assert.equal(op.matchedRule, null)
})

test('preview: дедуп по externalRef (повторный импорт)', () => {
  const ops = parseAlfaCsvStatement(csv([CARD]))
  const ref = ops[0].externalRef
  db.prepare('INSERT INTO transactions (id, accountId, externalRef) VALUES (?, ?, ?)').run('tx1', 'acc-alfa1', ref)
  const preview = buildAlfaCsvPreview(ops, db)
  assert.equal(preview.totals.alreadyImported, 1)
  assert.equal(preview.operations[0].alreadyImported, true)
  assert.equal(preview.operations[0].existingAccountId, 'acc-alfa1')
})

test.after(() => {
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
