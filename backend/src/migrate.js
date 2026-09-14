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

let count = 0
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

console.log(`Migrations done. ${count} new applied, ${files.length - count} skipped.`)
