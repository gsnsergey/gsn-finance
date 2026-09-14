// Суммы: рубли → копейки и обратно
export function rubToKop(rub) {
  const n = typeof rub === 'string' ? parseFloat(rub.replace(',', '.')) : Number(rub)
  if (!Number.isFinite(n)) throw new Error(`invalid amount: ${rub}`)
  return Math.round(n * 100)
}

export function kopToRub(kop) {
  const n = Number(kop) / 100
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
}

// Дата: дефолт — сегодня, ISO YYYY-MM-DD
export function todayIso() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function nowIso() {
  return new Date().toISOString()
}

// Простой парсер аргументов --key value / --flag / --key=value
export function parseFlags(argv) {
  const out = { _: [], bool: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      let key, val
      if (eq !== -1) {
        key = a.slice(2, eq); val = a.slice(eq + 1)
      } else {
        key = a.slice(2)
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) { val = next; i++ } else { val = true }
      }
      if (val === true) out.bool[key] = true
      else out[key] = val
    } else {
      out._.push(a)
    }
  }
  return out
}

export function requireFlag(flags, name) {
  if (flags[name] === undefined) throw new Error(`missing required flag: --${name}`)
  return flags[name]
}

export function ok(msg) {
  console.log(`✓ ${msg}`)
}
