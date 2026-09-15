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

// SQLite LIKE/LOWER без учёта регистра работают только для ASCII, а комментарии
// и названия у нас кириллицей. Регистрируем deterministic-функцию приведения к
// нижнему регистру на JS (Unicode-aware), чтобы поиск (transactions?q=…:
// комментарий, счёт, категория) не зависел от регистра для любых языков.
db.function('lower_unicode', { deterministic: true }, (value) =>
  value == null ? null : String(value).toLowerCase()
)

export default db
export { dbPath, dataDir }
