import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../data')

// Путь к БД переопределяется через FINANS_DB (нужно для тестов/verify.sh,
// чтобы не трогать рабочий data/finans.db). Относительный путь — от cwd.
const envDb = process.env.FINANS_DB
const dbPath = envDb
  ? (path.isAbsolute(envDb) ? envDb : path.resolve(process.cwd(), envDb))
  : path.join(dataDir, 'finans.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export default db
export { dbPath, dataDir }
