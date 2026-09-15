// Интеграционная проверка preview/записи CSV-выписки Точка-Банка
// (buildTochkaPreview + applyImport): резолв счетов и дедуп.
//
// Регрессия: «Номер документа» Точки уникален лишь внутри счёта/периода, поэтому
// дедуп по одному externalRef ложно помечал НОВУЮ операцию как «уже в БД» —
// операция с тем же номером документа на другом счёте/в другом году блокировала
// импорт (в базе её при этом не было). Теперь ключ Точки включает счёт и дату,
// а дубль подтверждается ещё и совпадением даты/суммы/счёта.
//
// Запуск:
//   node --test backend/src/lib/import.tochka.test.js
//
// Изоляция: FINANS_DB указывает на временную БД, рабочий data/finans.db не
// читается и не пишется. Env выставляется ДО динамического импорта import.js
// (тот подтягивает db.js, читающий FINANS_DB).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { parseTochkaStatement } from './parsers/tochka.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finans-tochka-'))
const dbPath = path.join(tmpDir, 'test.db')
process.env.FINANS_DB = dbPath

// --- схема (минимально достаточная для preview/applyImport) -----------------
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
  INSERT INTO accounts (id, name, bank, accountNumber, archived, balance) VALUES
    ('acc-tax',    'Точка (На налоги)',       'tochka', '40802810201500197454', 0, 0),
    ('acc-gsn',    'Точка (GSN)',             'tochka', '40802810901500113741', 0, 0),
    ('acc-invest', 'Точка (На инвестирование)','tochka', '40802810701500252611', 0, 0);

  -- Уже импортированный перевод между своими счетами: старый ключ tchk-doc-1,
  -- счёт-источник На инвестирование (другой, чем в новой выписке).
  INSERT INTO transactions (id, accountId, type, amount, currency, date, source, externalRef, transferDirection, createdAt, updatedAt) VALUES
    ('legacy-out', 'acc-invest', 'transfer', 650000, 'RUB', '2026-01-09', 'import', 'tchk-doc-1', 'out', '2026-01-09T00:00:00Z', '2026-01-09T00:00:00Z'),
    ('legacy-in',  'acc-gsn',    'transfer', 650000, 'RUB', '2026-01-09', 'import', 'tchk-doc-1', 'in',  '2026-01-09T00:00:00Z', '2026-01-09T00:00:00Z');
`)
seed.close()

const { buildTochkaPreview, applyImport } = await import('./import.js')
const db = new Database(dbPath)

// --- фикстура ---------------------------------------------------------------
const HEADER = ['Дата проводки', 'Дата документа', 'Дата списания', 'Дата зачисления', 'Номер документа',
  'Направление', 'Сумма операции', 'Сумма операции в рублях', 'Входящий остаток', 'Исходящий остаток',
  'Назначение платежа', 'Наименование плательщика', 'Счет плательщика', 'ИНН плательщика', 'КПП плательщика',
  'Бик банка плательщика', 'Наименование банка плательщика', 'Адрес банка плательщика', 'Корр. счёт банка плательщика',
  'Наименование получателя', 'Счет получателя', 'ИНН получателя', 'КПП получателя', 'Бик банка получателя',
  'Наименование банка получателя', 'Адрес банка получателя', 'Корр. счет банка получателя',
  'Курс конвертации', 'Сумма после конвертации', 'Приоритет', 'Тип документа', 'Бюджетный', 'Бюджетный: статус',
  'Бюджетный: КБК', 'Бюджетный: ОКАТО', 'Бюджетный: Основание', 'Бюджетный: Период', 'Бюджетный: Номер',
  'Бюджетный: дата', 'Бюджетный: тип', 'Основание списания', 'Код']

// Перевод собственных средств: одна строка выписки, docNumber, счета.
function ownTransferRow({ date, doc, amount, payerAccount, payeeAccount, payerName, payeeName }) {
  const row = new Array(42).fill('')
  row[0] = date; row[1] = date; row[4] = doc
  row[5] = 'Исходящий'; row[6] = amount; row[7] = amount
  row[10] = 'Перевод собственных средств. Без НДС.'
  row[11] = payerName; row[12] = payerAccount
  row[19] = payeeName; row[20] = payeeAccount
  return row
}

const csv = rows => '\uFEFF' + HEADER.join(';') + '\n' + rows.map(r => r.join(';')).join('\n')

// Новая выписка за 2025-01-14: перевод На налоги → GSN, номер документа 1 —
// тот же номер, что у уже импортированного перевода 2026-01-09 (другой счёт).
const NEW_2025 = ownTransferRow({
  date: '14.01.2025', doc: '1', amount: '1 000,00',
  payerAccount: '40802810201500197454', payeeAccount: '40802810901500113741',
  payerName: 'ИП АЛЕКСЕЕВ', payeeName: 'ООО GSN'
})

// Повторный импорт того же перевода 2026-01-09 (легаси-строка уже в БД).
const LEGACY_2026 = ownTransferRow({
  date: '09.01.2026', doc: '1', amount: '6 500,00',
  payerAccount: '40802810701500252611', payeeAccount: '40802810901500113741',
  payerName: 'ИП ГОВЯЗИН', payeeName: 'ООО GSN'
})

function preview(row) {
  return buildTochkaPreview(parseTochkaStatement(csv([row])), db)
}

test('ключ новой операции Точки включает счёт и дату', () => {
  const op = preview(NEW_2025).operations[0]
  assert.equal(op.externalRef, 'tchk-40802810201500197454-20250114-doc-1')
})

test('регрессия: чужой номер документа не помечает новую операцию «уже в БД»', () => {
  const op = preview(NEW_2025).operations[0]
  // Раньше ref tchk-doc-1 совпадал с легаси-переводом 2026-01-09 на другом
  // счёте → alreadyImported=true, хотя операции в базе не было.
  assert.equal(op.alreadyImported, false)
  assert.equal(op.existingAccountId, undefined)
  // Счета при этом резолвятся автоматически.
  assert.equal(op.resolvedAccountId, 'acc-tax')
  assert.equal(op.transferAccountId, 'acc-gsn')
})

test('новая операция импортируется и повторно не дублируется', () => {
  const op = preview(NEW_2025).operations[0]
  const payload = [{
    externalRef: op.externalRef,
    accountId: op.resolvedAccountId,
    transferAccountId: op.transferAccountId,
    type: op.type,
    amount: op.amount,
    date: op.date,
    bankSource: 'tochka'
  }]

  const first = applyImport(payload, db)
  assert.equal(first.created, 2)   // две ноги перевода
  assert.equal(first.skipped, 0)

  const second = applyImport(payload, db)
  assert.equal(second.created, 0)
  assert.equal(second.skipped, 1)

  // Новому переводу достался уникальный ключ — он не делится с легаси-парой.
  const refs = db.prepare(`SELECT DISTINCT externalRef FROM transactions WHERE type = 'transfer' ORDER BY externalRef`).all()
  const values = refs.map(r => r.externalRef)
  assert.ok(values.includes('tchk-40802810201500197454-20250114-doc-1'))
  assert.ok(values.includes('tchk-doc-1'))
  const count = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE externalRef = ?`).get('tchk-40802810201500197454-20250114-doc-1').n
  assert.equal(count, 2)
})

test('повторный импорт старой выписки по-прежнему распознаётся как дубль', () => {
  // Легаси-строка хранится под tchk-doc-1; новый ключ находится по алиасу и
  // подтверждается совпадением даты/суммы/счетов.
  const op = preview(LEGACY_2026).operations[0]
  assert.equal(op.alreadyImported, true)
  assert.equal(op.existingAccountId, 'acc-invest')
  assert.equal(op.existingTransferAccountId, 'acc-gsn')
})

test.after(() => {
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
