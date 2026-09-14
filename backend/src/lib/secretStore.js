// Симметричное шифрование токенов брокеров (AES-256-GCM) с мастер-ключом
// в data/.encryption.key (права 0600).
//
// Формат tokenCiphertext в БД: base64(iv[12] || ciphertext[N] || authTag[16]).
// IV генерируется на каждый encrypt отдельно → одинаковые токены дают разные
// ciphertext'ы (семантическая безопасность).
//
// Если мастер-ключ потерян — все токены в БД превращаются в тыкву
// (расшифровать нечем). Trade-off такой же, как у 1Password / Bitwarden:
// см. README + UI Настроек (баннер «Не удаляйте data/.encryption.key»).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../db.js'

const KEY_FILE = path.join(dataDir, '.encryption.key')
const ALGORITHM = 'aes-256-gcm'

// Загружает (или создаёт при первом запуске) мастер-ключ.
// Возвращает Buffer длиной 32 байта (256 бит).
function loadOrCreateMasterKey() {
  try {
    const buf = fs.readFileSync(KEY_FILE)
    if (buf.length !== 32) throw new Error(`unexpected key length ${buf.length}`)
    return buf
  } catch {
    const key = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
    // Попытаться выставить права ещё раз (на некоторых FS writeFileSync с mode
    // не сработает — например, если файл уже существовал с другими правами).
    try { fs.chmodSync(KEY_FILE, 0o600) } catch {}
    return key
  }
}

const masterKey = loadOrCreateMasterKey()

// Зашифровать plaintext → base64(iv || ciphertext || tag).
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encryptSecret: пустой или нестроковый секрет')
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, enc, tag]).toString('base64')
}

// Расшифровать base64 → plaintext. Бросает, если данные повреждены или
// ключ сменился — это явный сигнал «потеряли мастер-ключ».
export function decryptSecret(b64) {
  if (typeof b64 !== 'string' || !b64) throw new Error('decryptSecret: пустой ciphertext')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 12 + 16) throw new Error('decryptSecret: слишком короткий ciphertext')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const enc = buf.subarray(12, buf.length - 16)
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

// Маска для UI: «••••••••ABCD» — последние 4 видимых символа токена.
// Без расшифровки (оперируем по уже зашифрованному ciphertext'у нельзя —
// в нём нет открытых символов исходного токена), поэтому маску считаем
// при создании/обновлении записи и кладём открытым полем в БД.
// В нашей схеме поле-маски пока не выделено; вместо этого API маркирует
// ответ: при GET возвращает `tokenMask`, при POST/PATCH — `token` целиком.
export function maskOf(plaintext) {
  if (!plaintext) return ''
  const visible = plaintext.slice(-4)
  return `••••••••${visible}`
}