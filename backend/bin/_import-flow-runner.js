// Утилита для bin/test-import-flow.sh.
//
// Принимает PDF-буфер из stdin, прогоняет через previewAlfaFromPdf +
// applyAlfaImport (с дедупом), печатает JSON-результат на stdout.
//
// Использование:
//   generatePdf.js > out.pdf
//   _import-flow-runner.js --seed-account <json> --import <items.json> < out.pdf > result.json
//
// Или через stdin JSON-команды:
//   echo '{"pdfPath": "...", "seed": {...}, "import": [...]}' | node _import-flow-runner.js

import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import db from '../src/db.js'
import { buildAlfaPreview, applyAlfaImport, previewAlfaFromPdf } from '../src/lib/import.js'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function main() {
  const raw = await readStdin()
  let cmd
  try {
    cmd = JSON.parse(raw.toString('utf8'))
  } catch (e) {
    process.stderr.write(`bad JSON in stdin: ${e.message}\n`)
    process.exit(1)
  }

  // 1. Сидим данные (account + account_card).
  if (cmd.seed?.account) {
    const a = cmd.seed.account
    const id = a.id || uuid()
    db.prepare(`
      INSERT INTO accounts (id, name, bank, type, currency, balance, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, a.name, a.bank || null, a.type || 'debit', a.currency || 'RUB',
           a.balance ?? 0, a.createdAt || new Date().toISOString(), new Date().toISOString())
    for (const card of (a.cards || [])) {
      db.prepare(`INSERT INTO account_cards (id, accountId, panMask, label) VALUES (?, ?, ?, ?)`)
        .run(uuid(), id, card.panMask, card.label || null)
    }
  }

  // 2. Читаем PDF.
  const pdfBuffer = fs.readFileSync(cmd.pdfPath)

  // 3. Preview.
  const preview = await previewAlfaFromPdf(pdfBuffer, db)

  // 4. Import (если передан items).
  let importResult = null
  if (cmd.import) {
    importResult = applyAlfaImport(cmd.import, db)
  }

  // 5. Re-preview (для проверки дедупа).
  const replayPreview = await previewAlfaFromPdf(pdfBuffer, db)

  // 6. Re-import (повторный — должен весь skipped).
  let reimportResult = null
  if (cmd.import) {
    reimportResult = applyAlfaImport(cmd.import, db)
  }

  // 7. Текущее состояние БД.
  const accounts = db.prepare(`SELECT id, name, balance FROM accounts ORDER BY name`).all()
  const txCount = db.prepare(`SELECT COUNT(*) as c FROM transactions`).get().c
  const txSum = db.prepare(`SELECT type, COALESCE(SUM(amount), 0) as s FROM transactions GROUP BY type`).all()

  process.stdout.write(JSON.stringify({
    preview,
    importResult,
    replayPreview,
    reimportResult,
    state: { accounts, txCount, txSum }
  }, null, 2))
}

main().catch(e => {
  process.stderr.write(`runner failed: ${e.stack || e.message}\n`)
  process.exit(1)
})