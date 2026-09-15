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
    id TEXT PRIMARY KEY, name TEXT, bank TEXT, accountNumber TEXT, archived INTEGER DEFAULT 0,
    balance INTEGER DEFAULT 0, balanceAsOf TEXT, updatedAt TEXT
  );
  CREATE TABLE account_cards (
    id TEXT PRIMARY KEY, accountId TEXT, panMask TEXT, label TEXT
  );
  CREATE TABLE categories (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, archived INTEGER DEFAULT 0
  );
  CREATE TABLE import_rules (
    id TEXT PRIMARY KEY, accountId TEXT, matchType TEXT, matchValue TEXT,
    categoryId TEXT, priority INTEGER
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, accountId TEXT, externalRef TEXT,
    categoryId TEXT, type TEXT, amount INTEGER,
    currency TEXT, date TEXT, comment TEXT, source TEXT, transferDirection TEXT,
    rawSource TEXT,
    createdAt TEXT, updatedAt TEXT
  );
  INSERT INTO categories (id, name, type, archived) VALUES
    ('cat-prod', 'Продукты', 'expense', 0),
    ('cat-prod-in', 'Продукты', 'income', 0),
    ('cat-svyaz', 'Связь', 'expense', 0),
    ('cat-other-e', 'Прочее', 'expense', 0),
    ('cat-other-i', 'Прочее', 'income', 0),
    ('cat-transfers', 'Переводы', 'expense', 0);
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
const { buildAlfaCsvPreview, applyImport } = await import('./import.js')
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
  // Дубль подтверждается не только ref, но и датой/суммой/счётом — сеем
  // реальную строку, как её записал бы applyImport.
  db.prepare('INSERT INTO transactions (id, accountId, externalRef, categoryId, type, amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('tx1', 'acc-alfa1', ref, 'cat-prod', 'expense', 10000, ops[0].date)
  const preview = buildAlfaCsvPreview(ops, db)
  assert.equal(preview.totals.alreadyImported, 1)
  assert.equal(preview.operations[0].alreadyImported, true)
  // Дубль показывает реальные данные из БД, а не пустые поля.
  assert.equal(preview.operations[0].existingAccountId, 'acc-alfa1')
  assert.equal(preview.operations[0].existingCategoryId, 'cat-prod')
  assert.equal(preview.operations[0].existingType, 'expense')
})

test('preview: дубль не попадает в счётчик «без счёта»', () => {
  // UNKNOWN не резолвится по номеру (нет в БД) → без дубля unresolvedAccount=1.
  // Помечаем его уже импортированным — счётчик должен обнулиться.
  const ops = parseAlfaCsvStatement(csv([UNKNOWN]))
  assert.equal(buildAlfaCsvPreview(ops, db).totals.unresolvedAccount, 1)
  db.prepare('INSERT INTO transactions (id, accountId, externalRef, categoryId, type, amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('tx2', 'acc-alfa1', ops[0].externalRef, null, 'expense', 1000, ops[0].date)
  assert.equal(buildAlfaCsvPreview(ops, db).totals.unresolvedAccount, 0)
})

test('preview: rawSource доносит исходную строку файла до UI', () => {
  const preview = previewFixture()
  const card = preview.operations.find(o => o.mcc === '5411')
  assert.ok(card.rawSource.includes('Krasnodar/MAGNIT'), 'обычная операция — своя строка')
  // transfer склеен из двух строк файла — отдаём обе.
  const transfer = preview.operations.find(o => o.type === 'transfer')
  assert.equal(transfer.rawSource.split('\n').length, 2)
})

test('preview: категория банка подставляется по вхождению («Связь» ⊂ «Связь, интернет и ТВ»)', () => {
  // MCC нет, правил нет → категория берётся из колонки category выписки.
  const row = ['08.03.2026', '08.03.2026', 'Текущий счёт', '40817810505974389734', '', '', 'МТС', '900', 'RUR', 'Выполнен', 'Связь, интернет и ТВ', '', 'Списание', '', '', '']
  const op = buildAlfaCsvPreview(parseAlfaCsvStatement(csv([row])), db).operations[0]
  assert.equal(op.bankCategory, 'Связь, интернет и ТВ')
  assert.equal(op.suggestedCategoryId, 'cat-svyaz')
})

test('preview: при одинаковом имени категория берётся по типу операции', () => {
  // «Прочее» есть и у расходов (cat-other-e), и у доходов (cat-other-i).
  const inc = ['05.09.2026', '05.09.2026', 'Текущий счёт', '40817810505974389734', '', '', 'Кэшбэк', '100', 'RUR', 'Выполнен', 'Прочее', '', 'Пополнение', '', '', '']
  const exp = ['06.09.2026', '06.09.2026', 'Текущий счёт', '40817810505974389734', '', '', 'Комиссия', '50', 'RUR', 'Выполнен', 'Прочее', '', 'Списание', '', '', '']
  const preview = buildAlfaCsvPreview(parseAlfaCsvStatement(csv([inc, exp])), db)
  assert.equal(preview.operations.find(o => o.date === '2026-09-05').suggestedCategoryId, 'cat-other-i')
  assert.equal(preview.operations.find(o => o.date === '2026-09-06').suggestedCategoryId, 'cat-other-e')
})

// --- applyImport: инвариант знака amount и зафиксированный остаток -------------
//
// applyImport — единый путь записи импорта (Альфа + Точка). Проверяем два
// инварианта учёта остатков:
//   1) transactions.amount всегда положителен (>= 0), знак берётся из type;
//   2) счёт с balanceAsOf (isFixed) не получает инкремент accounts.balance.

function addAccount(id, balance, balanceAsOf) {
  db.prepare(`INSERT INTO accounts (id, name, bank, accountNumber, archived, balance, balanceAsOf)
              VALUES (?, ?, 'alfa', NULL, 0, ?, ?)`).run(id, id, balance, balanceAsOf)
  return id
}

const balanceOf = id => db.prepare('SELECT balance FROM accounts WHERE id = ?').get(id).balance
const txByRef = ref => db.prepare('SELECT * FROM transactions WHERE externalRef = ?').get(ref)

test('applyImport: expense на счёт с balanceAsOf не меняет accounts.balance', () => {
  const accountId = addAccount('acc-fixed-exp', 100000, '2026-09-14')
  const res = applyImport(
    [{ externalRef: 'ref-fixed-exp', accountId, type: 'expense', amount: 5000, date: '2026-09-15' }],
    db
  )
  assert.equal(res.created, 1)
  assert.equal(balanceOf(accountId), 100000)   // снимок на дату фиксации не тронут
})

test('applyImport: amount в transactions положителен для expense', () => {
  const accountId = addAccount('acc-pos-exp', 100000, null)
  applyImport(
    [{ externalRef: 'ref-pos-exp', accountId, type: 'expense', amount: 5000, date: '2026-09-15' }],
    db
  )
  const tx = txByRef('ref-pos-exp')
  assert.equal(tx.type, 'expense')
  assert.equal(tx.amount, 5000)   // инвариант: amount >= 0, знак — из type
})

test('applyImport: на счёт без фиксации balance меняется на ±abs (expense −, income +)', () => {
  const accountId = addAccount('acc-free', 100000, null)
  applyImport([
    { externalRef: 'ref-free-exp', accountId, type: 'expense', amount: 5000, date: '2026-09-15' },
    { externalRef: 'ref-free-inc', accountId, type: 'income', amount: 30000, date: '2026-09-16' }
  ], db)
  assert.equal(balanceOf(accountId), 125000)   // 100000 − 5000 + 30000
  assert.equal(txByRef('ref-free-exp').amount, 5000)
  assert.equal(txByRef('ref-free-inc').amount, 30000)
})

test('applyImport: transfer двигает balance свободных счетов, фиксированные не трогает', () => {
  const fixed = addAccount('acc-trf-fixed', 100000, '2026-09-14')
  const free1 = addAccount('acc-trf-free1', 200000, null)
  const free2 = addAccount('acc-trf-free2', 300000, null)
  applyImport([
    { externalRef: 'ref-trf-1', accountId: fixed, transferAccountId: free1, type: 'transfer', amount: 7000, date: '2026-09-15' },
    { externalRef: 'ref-trf-2', accountId: free1, transferAccountId: free2, type: 'transfer', amount: 9000, date: '2026-09-16' }
  ], db)

  // Фиксированный источник: balance — снимок на balanceAsOf, инкремент запрещён.
  assert.equal(balanceOf(fixed), 100000)
  // free1: пришло 7000 (получатель ref-trf-1), ушло 9000 (источник ref-trf-2).
  assert.equal(balanceOf(free1), 198000)
  // free2: пришло 9000 (получатель ref-trf-2).
  assert.equal(balanceOf(free2), 309000)

  // Обе ноги положительны (инвариант amount), различаются transferDirection.
  const legs = db.prepare('SELECT amount, transferDirection FROM transactions WHERE externalRef = ? ORDER BY rowid').all('ref-trf-1')
  assert.equal(legs.length, 2)
  assert.deepEqual(legs.map(l => l.amount), [7000, 7000])
  assert.deepEqual(legs.map(l => l.transferDirection), ['out', 'in'])
})

test('applyImport: у expense/income transferDirection остаётся NULL', () => {
  const accountId = addAccount('acc-dir-null', 100000, null)
  applyImport([
    { externalRef: 'ref-dir-null-e', accountId, type: 'expense', amount: 1000, date: '2026-09-15' },
    { externalRef: 'ref-dir-null-i', accountId, type: 'income', amount: 2000, date: '2026-09-15' }
  ], db)
  assert.equal(txByRef('ref-dir-null-e').transferDirection, null)
  assert.equal(txByRef('ref-dir-null-i').transferDirection, null)
})

test('preview: дубль transfer различает ноги по transferDirection', () => {
  const ops = parseAlfaCsvStatement(csv([OWN_IN, OWN_OUT]))
  const transfer = buildAlfaCsvPreview(ops, db).operations.find(o => o.type === 'transfer')
  applyImport([{
    externalRef: transfer.externalRef,
    accountId: transfer.resolvedAccountId,
    transferAccountId: transfer.transferAccountId,
    type: 'transfer',
    amount: transfer.amount,
    date: transfer.date
  }], db)

  const dup = buildAlfaCsvPreview(ops, db).operations.find(o => o.type === 'transfer')
  assert.equal(dup.alreadyImported, true)
  assert.equal(dup.existingAccountId, 'acc-alfa2')          // out = источник
  assert.equal(dup.existingTransferAccountId, 'acc-alfa1')  // in = получатель
})

test('applyImport: сохраняет rawSource и склеивает userComment с банковским комментарием', () => {
  const accountId = addAccount('acc-raw', 100000, null)
  const account2 = addAccount('acc-raw2', 100000, null)
  applyImport([
    {
      externalRef: 'ref-raw-exp', accountId, type: 'expense', amount: 12345,
      date: '2026-09-15', mcc: '5411', merchantName: 'MAGNIT',
      bankSource: 'alfa', userComment: 'Мой текст', rawSource: 'CSV;ROW;MAGNIT'
    },
    {
      // Пустое (пробельное) примечание не должно давать « · » без левой части.
      externalRef: 'ref-raw-no-uc', accountId, type: 'expense', amount: 5000,
      date: '2026-09-15', mcc: '5411', merchantName: 'MAGNIT',
      bankSource: 'alfa', userComment: '   ', rawSource: 'CSV;ROW;2'
    },
    {
      externalRef: 'ref-raw-trf', accountId, transferAccountId: account2,
      type: 'transfer', amount: 9000, date: '2026-09-16',
      bankSource: 'tochka', userComment: 'Перевод себе', rawSource: 'trf-src-1\ntrf-src-2'
    }
  ], db)

  const exp = txByRef('ref-raw-exp')
  assert.equal(exp.rawSource, 'CSV;ROW;MAGNIT')
  assert.equal(exp.comment, 'Мой текст · [Импорт Альфа] MCC 5411 / MAGNIT')

  const noUc = txByRef('ref-raw-no-uc')
  assert.equal(noUc.rawSource, 'CSV;ROW;2')
  assert.equal(noUc.comment, '[Импорт Альфа] MCC 5411 / MAGNIT')

  // Обе ноги перевода получают одинаковый rawSource и комментарий.
  const legs = db.prepare('SELECT rawSource, comment FROM transactions WHERE externalRef = ? ORDER BY rowid').all('ref-raw-trf')
  assert.equal(legs.length, 2)
  assert.deepEqual(legs.map(l => l.rawSource), ['trf-src-1\ntrf-src-2', 'trf-src-1\ntrf-src-2'])
  assert.equal(legs[0].comment, 'Перевод себе · [Импорт Точка · перевод]')
})

test('applyImport: без userComment и rawSource колонки остаются NULL/авто', () => {
  const accountId = addAccount('acc-plain', 100000, null)
  applyImport([
    { externalRef: 'ref-plain', accountId, type: 'expense', amount: 100, date: '2026-09-15' }
  ], db)
  const tx = txByRef('ref-plain')
  assert.equal(tx.rawSource, null)
  assert.equal(tx.comment, 'Импорт Альфа')
})

test.after(() => {
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
