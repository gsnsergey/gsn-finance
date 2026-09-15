import db from './db.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, 'migrations')

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  appliedAt TEXT NOT NULL
)`)

const applied = new Set(db.prepare('SELECT name FROM migrations').all().map(r => r.name))

const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

// Миграции, пересоздающие таблицу (смена CHECK-ограничения: accounts.type),
// несовместимы с включённым FK: DROP TABLE родителя каскадно удалил бы
// дочерние строки (account_cards, transactions — ON DELETE CASCADE).
// PRAGMA foreign_keys — no-op внутри транзакции, поэтому выключаем его до
// начала транзакций и включаем обратно после всех миграций.
db.pragma('foreign_keys = OFF')

let count = 0
try {
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} (already applied)`)
      continue
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    const tx = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO migrations (name, appliedAt) VALUES (?, ?)').run(file, new Date().toISOString())
    })
    tx()
    console.log(`✓ ${file} applied`)
    count++
  }
} finally {
  db.pragma('foreign_keys = ON')
}

// После пересоздания таблиц убеждаемся, что ссылочная целостность не поехала.
const fkViolations = db.pragma('foreign_key_check')
if (fkViolations.length > 0) {
  console.error('✗ foreign_key_check нашёл нарушения после миграций:')
  for (const v of fkViolations) console.error(`  ${v.table} rowid=${v.rowid} → ${v.parent}`)
  process.exit(1)
}

console.log(`Migrations done. ${count} new applied, ${files.length - count} skipped.`)
