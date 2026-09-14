#!/usr/bin/env bash
#
# Детерминированная проверка «фиксация остатка» (balance + balanceAsOf, сверка, 409 на ретро).
#
#   ./bin/verify.sh
#
# Изоляция: поднимается ОТДЕЛЬНЫЙ сервер на порту 3739 с временной БД (FINANS_DB).
# Рабочий сервер на 3737 и рабочий data/finans.db не трогаются — реальная БД
# только читается/копируется во временный каталог (сценарий g).
#
# Печатает PASS/FAIL по каждому пункту; exit 1, если хоть один пункт провален.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${VERIFY_PORT:-3739}"
WORK_DB="$ROOT/data/finans.db"
TMPROOT="${TMPDIR:-/tmp}"
TMP="$(mktemp -d "${TMPROOT%/}/finans-verify.XXXXXX")"
DB="$TMP/verify.db"
SERVER_LOG="$TMP/server.log"
SRV_PID=""
PASS=0
FAIL=0

cleanup() {
  if [ -n "$SRV_PID" ] && kill -0 "$SRV_PID" 2>/dev/null; then
    kill "$SRV_PID" 2>/dev/null
    wait "$SRV_PID" 2>/dev/null
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

# --- вывод ------------------------------------------------------------------
step() { printf '\n%s\n' "$1"; }
pass() { PASS=$((PASS + 1)); printf '  \033[32m✔ PASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[31m✘ FAIL\033[0m  %s\n' "$1"; }
eq()   { if [ "$2" = "$3" ]; then pass "$1 (= $3)"; else fail "$1: ожидалось «$2», получено «$3»"; fi }

# --- предусловия ------------------------------------------------------------
for bin in node curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "✘ не найден $bin" >&2
    exit 1
  fi
done

BS3="$ROOT/node_modules/better-sqlite3"
[ -d "$BS3" ] || BS3="$ROOT/backend/node_modules/better-sqlite3"
if [ ! -d "$BS3" ]; then
  echo "✘ не найден модуль better-sqlite3 (нужен для проверки миграции копии БД)" >&2
  exit 1
fi

# --- вспомогательные node-скрипты (во временном каталоге) -------------------

# json.js <dotted.path> : читает JSON со stdin, печатает значение ('null' для null/undefined)
cat > "$TMP/json.js" <<'EOF'
let raw = ''
process.stdin.on('data', d => { raw += d })
process.stdin.on('end', () => {
  let v
  try { v = JSON.parse(raw) } catch { process.stdout.write('PARSE_ERROR'); return }
  for (const key of String(process.argv[2]).split('.')) {
    if (v === null || v === undefined) break
    if (Array.isArray(v) && key === 'length') { v = v.length; break }
    v = Array.isArray(v) ? v[Number(key)] : v[key]
  }
  process.stdout.write(v === undefined || v === null ? 'null' : String(v))
})
EOF

# dbcheck.js <better-sqlite3 path> <dbfile> backup <dest> | integrity | count <table>
cat > "$TMP/dbcheck.js" <<'EOF'
const Database = require(process.argv[2])
const file = process.argv[3]
const action = process.argv[4]

if (action === 'backup') {
  const src = new Database(file, { readonly: true, fileMustExist: true })
  src.backup(process.argv[5])
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1) })
} else {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  if (action === 'count') {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${process.argv[5]}`).get()
    process.stdout.write(String(row.c))
  } else if (action === 'integrity') {
    // accounts: сколько всего / без фиксации / у скольких реальный остаток <> balance
    const sql = `SELECT
        (SELECT COUNT(*) FROM accounts) AS total,
        (SELECT COUNT(*) FROM accounts WHERE balanceAsOf IS NULL) AS unfixed,
        (SELECT COUNT(*) FROM accounts a WHERE (
          a.balance + CASE WHEN a.balanceAsOf IS NULL THEN 0 ELSE COALESCE((
            SELECT SUM(CASE t.type WHEN 'expense' THEN -t.amount WHEN 'income' THEN t.amount ELSE 0 END)
              FROM transactions t
             WHERE t.accountId = a.id AND date(t.date) > date(a.balanceAsOf)
          ), 0) END
        ) <> a.balance) AS mismatch`
    const row = db.prepare(sql).get()
    process.stdout.write(`${row.total} ${row.unfixed} ${row.mismatch}`)
  } else {
    console.error(`unknown action: ${action}`)
    process.exit(2)
  }
}
EOF

J() { node "$TMP/json.js" "$1" < "$2"; }          # J <path> <jsonfile>
API="http://localhost:$PORT/api"

# ---------------------------------------------------------------------------
step "0. Синтаксис изменённых JS (node --check)"
CHANGED="backend/src/db.js backend/src/balance.js
backend/src/routes/accounts.js backend/src/routes/crud.js
backend/src/routes/transactions.js backend/src/routes/index.js
cli/lib/api.js cli/lib/commands.js cli/lib/index.js
ui/js/api.js ui/js/views/accounts.js ui/js/views/dashboard.js
ui/js/views/transactions.js"
for f in $CHANGED; do
  if out=$(node --check "$f" 2>&1); then pass "node --check $f"; else fail "node --check $f — $out"; fi
done

step "1. Изоляция: рабочий сервер на 3737 и рабочий data/finans.db не трогаются"
if curl -sf --max-time 2 "http://localhost:3737/api/health" >/dev/null 2>&1; then
  pass "рабочий сервер на 3737 отвечает (не тронут)"
else
  pass "сервер на 3737 не запущен — проверка идёт на изолированном порту $PORT"
fi
if curl -sf --max-time 2 "$API/health" >/dev/null 2>&1; then
  fail "порт $PORT уже занят — освободи его (verify.sh не убивает чужие процессы)"
  exit 1
fi
pass "порт $PORT свободен"

step "2. Миграции на временной БД (FINANS_DB=$DB)"
if FINANS_DB="$DB" node backend/src/migrate.js >"$TMP/migrate.log" 2>&1; then
  pass "миграции применены"
else
  fail "миграции не применились: $(cat "$TMP/migrate.log")"
fi
if FINANS_DB="$DB" node -e '
const Database = require(process.argv[1])
const db = new Database(process.argv[2], { readonly: true })
const cols = db.prepare("PRAGMA table_info(accounts)").all().map(c => c.name)
process.exit(cols.includes("balanceAsOf") ? 0 : 1)
' "$BS3" "$DB"; then
  pass "колонка accounts.balanceAsOf существует"
else
  fail "колонки accounts.balanceAsOf нет"
fi

step "3. Запуск изолированного сервера (PORT=$PORT)"
FINANS_DB="$DB" PORT="$PORT" node backend/src/server.js >"$SERVER_LOG" 2>&1 &
SRV_PID=$!
UP=0
for _ in $(seq 1 60); do
  if curl -sf --max-time 1 "$API/health" >/dev/null 2>&1; then UP=1; break; fi
  sleep 0.25
done
if [ "$UP" = "1" ]; then
  pass "сервер поднялся (pid $SRV_PID)"
else
  fail "сервер не поднялся: $(cat "$SERVER_LOG" 2>/dev/null | tail -5)"
  printf '\nИТОГ: FAIL (%d провалов)\n' "$FAIL"
  exit 1
fi

TODAY="$(date +%F)"
YESTERDAY="$(date -v-1d +%F 2>/dev/null || date -d 'yesterday' +%F)"
TOMORROW="$(date -v+1d +%F 2>/dev/null || date -d 'tomorrow' +%F)"
WEEK_AGO="$(date -v-7d +%F 2>/dev/null || date -d '7 days ago' +%F)"
say() { printf '  · %s\n' "$1"; }
say "сегодня=$TODAY вчера=$YESTERDAY завтра=$TOMORROW неделю назад=$WEEK_AGO"

# --- (a) --------------------------------------------------------------------
step "a) Новый счёт balance=100000 без фиксации → currentBalance=100000"
CODE=$(curl -s -o "$TMP/a.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Verify Account","type":"debit","balance":100000}')
eq "a) POST /api/accounts → 201" "201" "$CODE"
AID=$(J id "$TMP/a.json")
if [ -z "$AID" ] || [ "$AID" = "null" ]; then
  fail "a) не удалось получить id счёта: $(cat "$TMP/a.json")"
  printf '\nИТОГ: FAIL (%d провалов)\n' "$FAIL"
  exit 1
fi
curl -s "$API/accounts/$AID" -o "$TMP/a2.json"
eq "a) balance" "100000" "$(J balance "$TMP/a2.json")"
eq "a) balanceAsOf" "null" "$(J balanceAsOf "$TMP/a2.json")"
eq "a) currentBalance" "100000" "$(J currentBalance "$TMP/a2.json")"

# --- (b) --------------------------------------------------------------------
step "b) Расход 500 вчера → currentBalance=99500"
CODE=$(curl -s -o "$TMP/b.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$AID\",\"type\":\"expense\",\"amount\":500,\"date\":\"$YESTERDAY\"}")
eq "b) POST /api/transactions → 201" "201" "$CODE"
curl -s "$API/accounts/$AID" -o "$TMP/b2.json"
eq "b) currentBalance" "99500" "$(J currentBalance "$TMP/b2.json")"
eq "b) balance (счёт без фиксации — инкрементально)" "99500" "$(J balance "$TMP/b2.json")"

# --- (c) --------------------------------------------------------------------
step "c) Сверка: actualBalance=100000 на сегодня → currentBalance=100000"
CODE=$(curl -s -o "$TMP/c.json" -w '%{http_code}' -X POST "$API/accounts/$AID/reconcile" \
  -H 'Content-Type: application/json' \
  -d "{\"actualBalance\":100000,\"asOf\":\"$TODAY\"}")
eq "c) POST /reconcile → 200" "200" "$CODE"
eq "c) after.balance" "100000" "$(J after.balance "$TMP/c.json")"
eq "c) after.balanceAsOf" "$TODAY" "$(J after.balanceAsOf "$TMP/c.json")"
eq "c) after.currentBalance" "100000" "$(J after.currentBalance "$TMP/c.json")"
eq "c) delta (расхождение до сверки)" "500" "$(J delta "$TMP/c.json")"

# превью сверки (без записи)
curl -s "$API/accounts/$AID/reconcile" -o "$TMP/c2.json"
eq "c) GET /reconcile → balanceAsOf" "$TODAY" "$(J balanceAsOf "$TMP/c2.json")"
eq "c) GET /reconcile → countAfter" "0" "$(J countAfter "$TMP/c2.json")"
eq "c) GET /reconcile → sumAfter" "0" "$(J sumAfter "$TMP/c2.json")"
eq "c) GET /reconcile → currentBalance" "100000" "$(J currentBalance "$TMP/c2.json")"

# --- (d) --------------------------------------------------------------------
step "d) Ретрооперация (дата <= balanceAsOf) → 409 retro_transaction с hint.options"
CODE=$(curl -s -o "$TMP/d.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$AID\",\"type\":\"expense\",\"amount\":500,\"date\":\"$TODAY\"}")
eq "d) POST /api/transactions → 409" "409" "$CODE"
eq "d) error" "retro_transaction" "$(J error "$TMP/d.json")"
eq "d) accountId" "$AID" "$(J accountId "$TMP/d.json")"
eq "d) date" "$TODAY" "$(J date "$TMP/d.json")"
eq "d) balanceAsOf" "$TODAY" "$(J balanceAsOf "$TMP/d.json")"
eq "d) balance" "100000" "$(J balance "$TMP/d.json")"
eq "d) currentBalance" "100000" "$(J currentBalance "$TMP/d.json")"
eq "d) hint.options[0].action" "reconcile" "$(J hint.options.0.action "$TMP/d.json")"
eq "d) hint.options[0].path" "/api/accounts/$AID/reconcile" "$(J hint.options.0.path "$TMP/d.json")"
eq "d) hint.options[1].action" "move_balance_as_of" "$(J hint.options.1.action "$TMP/d.json")"
eq "d) hint.options[1].path" "/api/accounts/$AID" "$(J hint.options.1.path "$TMP/d.json")"
eq "d) hint.options[1].body.balanceAsOf" "$YESTERDAY" "$(J hint.options.1.body.balanceAsOf "$TMP/d.json")"
curl -s "$API/transactions?accountId=$AID" -o "$TMP/d2.json"
eq "d) ретрооперация не записана (всего операций)" "1" "$(J length "$TMP/d2.json" 2>/dev/null || echo '?')"

# --- (e) --------------------------------------------------------------------
# Операция завтрашним днём: попадает в незафиксированную зону → 201,
# зафиксированный balance не меняется, реальный считается сверх него.
# 50 копеек — из ожидаемого значения ТЗ: currentBalance = 100000 − 50 = 99950.
step "e) Расход 50 завтра → 201, balance=100000, currentBalance=99950"
CODE=$(curl -s -o "$TMP/e.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$AID\",\"type\":\"expense\",\"amount\":50,\"date\":\"$TOMORROW\"}")
eq "e) POST /api/transactions → 201" "201" "$CODE"
curl -s "$API/accounts/$AID" -o "$TMP/e2.json"
eq "e) balance (не меняется у счёта с фиксацией)" "100000" "$(J balance "$TMP/e2.json")"
eq "e) balanceAsOf" "$TODAY" "$(J balanceAsOf "$TMP/e2.json")"
eq "e) currentBalance" "99950" "$(J currentBalance "$TMP/e2.json")"

# --- (f) --------------------------------------------------------------------
step "f) PATCH balanceAsOf = сегодня−7д → currentBalance не изменился"
CODE=$(curl -s -o "$TMP/f.json" -w '%{http_code}' -X PATCH "$API/accounts/$AID" \
  -H 'Content-Type: application/json' \
  -d "{\"balanceAsOf\":\"$WEEK_AGO\"}")
eq "f) PATCH /api/accounts/:id → 200" "200" "$CODE"
eq "f) balanceAsOf" "$WEEK_AGO" "$(J balanceAsOf "$TMP/f.json")"
eq "f) currentBalance (не изменился)" "99950" "$(J currentBalance "$TMP/f.json")"
say "пересчитанный зафиксированный balance = $(J balance "$TMP/f.json") (100500 при 99950 реального)"

# ответ PATCH содержит и balance, и currentBalance
if [ "$(J balance "$TMP/f.json")" != "null" ] && [ "$(J currentBalance "$TMP/f.json")" != "null" ]; then
  pass "f) ответ PATCH содержит balance и currentBalance"
else
  fail "f) в ответе PATCH нет balance и/или currentBalance"
fi

# --- (g) --------------------------------------------------------------------
step "g) Миграция КОПИИ рабочей data/finans.db: счета без фиксации, currentBalance = balance"
if [ ! -f "$WORK_DB" ]; then
  fail "g) рабочая БД $WORK_DB не найдена"
else
  REAL_COPY="$TMP/real-copy.db"
  # только чтение источника (online backup), запись — в копию во временном каталоге
  if node "$TMP/dbcheck.js" "$BS3" "$WORK_DB" backup "$REAL_COPY" >"$TMP/backup.log" 2>&1; then
    pass "g) копия рабочей БД сделана (источник открыт readonly)"
  else
    fail "g) не удалось скопировать рабочую БД: $(cat "$TMP/backup.log")"
  fi

  if [ -f "$REAL_COPY" ]; then
    if FINANS_DB="$REAL_COPY" node backend/src/migrate.js >"$TMP/migrate-copy.log" 2>&1; then
      pass "g) миграции применены к копии"
    else
      fail "g) миграции к копии не применились: $(cat "$TMP/migrate-copy.log")"
    fi
    INTEGRITY=$(node "$TMP/dbcheck.js" "$BS3" "$REAL_COPY" integrity 2>&1)
    G_TOTAL=$(echo "$INTEGRITY" | awk '{print $1}')
    G_UNFIXED=$(echo "$INTEGRITY" | awk '{print $2}')
    G_MISMATCH=$(echo "$INTEGRITY" | awk '{print $3}')
    eq "g) всего счетов" "12" "$G_TOTAL"
    eq "g) счетов с balanceAsOf IS NULL" "$G_TOTAL" "$G_UNFIXED"
    eq "g) счетов, у которых currentBalance <> balance" "0" "$G_MISMATCH"
  fi
fi

# --- дополнительно ----------------------------------------------------------
step "доп) Сводка net-worth и список счетов используют реальный остаток"
curl -s "$API/accounts" -o "$TMP/n1.json"
eq "доп) GET /api/accounts отдаёт currentBalance" "99950" "$(J 0.currentBalance "$TMP/n1.json")"
curl -s "$API/summary/net-worth" -o "$TMP/n2.json"
eq "доп) accountsTotal в /summary/net-worth" "99950" "$(J accountsTotal "$TMP/n2.json")"

step "доп) Сдвиг фиксации разрешает ретрооперацию из 409-подсказки"
curl -s -X PATCH "$API/accounts/$AID" -H 'Content-Type: application/json' \
  -d "{\"balanceAsOf\":\"$YESTERDAY\"}" -o "$TMP/n3.json"
CODE=$(curl -s -o "$TMP/n4.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$AID\",\"type\":\"expense\",\"amount\":500,\"date\":\"$TODAY\"}")
eq "доп) операция на $TODAY после сдвига фиксации на $YESTERDAY → 201" "201" "$CODE"
curl -s "$API/accounts/$AID" -o "$TMP/n5.json"
eq "доп) currentBalance = 99950 − 500" "99450" "$(J currentBalance "$TMP/n5.json")"

step "доп) PATCH операции: правка комментария в зафиксированной зоне не блокируется"
curl -s -X POST "$API/accounts/$AID/reconcile" -H 'Content-Type: application/json' \
  -d "{\"actualBalance\":100000,\"asOf\":\"$TODAY\"}" -o "$TMP/m1.json"
curl -s "$API/transactions?accountId=$AID&type=expense" -o "$TMP/m2.json"
TX_ID=$(node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
const want = process.argv[2]
const row = rows.find(r => String(r.date).slice(0, 10) === want)
process.stdout.write(row ? row.id : "null")
' "$TMP/m2.json" "$YESTERDAY")
if [ -z "$TX_ID" ] || [ "$TX_ID" = "null" ]; then
  fail "доп) не нашлась операция от $YESTERDAY"
else
  # ровно такой payload шлёт UI при редактировании (объект целиком)
  CODE=$(curl -s -o "$TMP/m3.json" -w '%{http_code}' -X PATCH "$API/transactions/$TX_ID" \
    -H 'Content-Type: application/json' \
    -d "{\"accountId\":\"$AID\",\"type\":\"expense\",\"amount\":500,\"currency\":\"RUB\",\"date\":\"$YESTERDAY\",\"comment\":\"правка комментария\",\"source\":\"manual\"}")
  eq "доп) PATCH (комментарий) операции внутри зоны → 200" "200" "$CODE"
  # а перенос даты внутрь зоны — всё ещё 409
  CODE=$(curl -s -o "$TMP/m4.json" -w '%{http_code}' -X PATCH "$API/transactions/$TX_ID" \
    -H 'Content-Type: application/json' -d "{\"date\":\"$WEEK_AGO\"}")
  eq "доп) PATCH (перенос даты внутрь зоны) → 409" "409" "$CODE"
  eq "доп) error" "retro_transaction" "$(J error "$TMP/m4.json")"
fi

# --- CLI (агент вносит операции именно через него) ---------------------------
FIN="node cli/bin/fin.js agent"

step "доп) CLI: сверка счёта"
if FINANS_API="http://localhost:$PORT" $FIN reconcile-account --account "Verify Account" \
     --balance 1000 --as-of "$TODAY" >"$TMP/cli1.out" 2>&1; then
  pass "доп) fin agent reconcile-account → exit 0"
else
  fail "доп) fin agent reconcile-account упал: $(cat "$TMP/cli1.out")"
fi
if grep -q "сверен на $TODAY" "$TMP/cli1.out"; then
  pass "доп) CLI сообщает дату сверки и остаток"
else
  fail "доп) неожиданный вывод CLI: $(cat "$TMP/cli1.out")"
fi

step "доп) CLI: 409 показывает два способа разрешения, а не стектрейс"
FINANS_API="http://localhost:$PORT" $FIN add-transaction --account "Verify Account" \
  --type expense --amount 500 --date "$TODAY" >"$TMP/cli2.out" 2>&1
CLI_EXIT=$?
eq "доп) CLI на ретрооперации → exit 1" "1" "$CLI_EXIT"
if grep -q "Ретрооперация не принята" "$TMP/cli2.out"; then
  pass "доп) CLI объясняет причину по-русски"
else
  fail "доп) CLI не объяснил причину: $(cat "$TMP/cli2.out")"
fi
if grep -q "reconcile-account" "$TMP/cli2.out" && grep -q "update-account" "$TMP/cli2.out"; then
  pass "доп) CLI предлагает оба варианта (сверка / сдвиг balanceAsOf)"
else
  fail "доп) CLI не предложил оба варианта: $(cat "$TMP/cli2.out")"
fi
if grep -q "at Object\|at async\|Error:" "$TMP/cli2.out"; then
  fail "доп) CLI показал стектрейс"
else
  pass "доп) стектрейса нет"
fi

step "доп) CLI: list-accounts показывает реальный остаток и дату сверки"
if FINANS_API="http://localhost:$PORT" $FIN list-accounts >"$TMP/cli3.out" 2>&1; then
  pass "доп) fin agent list-accounts → exit 0"
else
  fail "доп) fin agent list-accounts упал: $(cat "$TMP/cli3.out")"
fi
if grep -q "сверен $TODAY" "$TMP/cli3.out"; then
  pass "доп) в списке видно «сверен ${TODAY}»"
else
  fail "доп) в списке нет даты сверки: $(cat "$TMP/cli3.out")"
fi

# --- UI: рендер карточек на заглушке DOM (без браузера) ----------------------
step "доп) UI: карточка счёта и дашборд считают реальный остаток"

cat > "$TMP/ui.js" <<'EOF'
const ROOT = process.argv[2]
const accounts = [
  { id: 'a1', name: 'Т-Банк', bank: 'tinkoff', type: 'debit', currency: 'RUB', balance: 100000, balanceAsOf: '2026-09-14', color: '#111111', archived: 0, currentBalance: 99950 },
  { id: 'a2', name: 'Сбер', bank: 'sber', type: 'card', currency: 'RUB', balance: 5000, balanceAsOf: null, color: null, archived: 0, currentBalance: 5000 },
  { id: 'a3', name: 'Архив', bank: null, type: 'card', currency: 'RUB', balance: 0, balanceAsOf: null, color: null, archived: 1, currentBalance: 0 }
]
globalThis.fetch = async (url) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify(String(url).includes('/api/accounts') ? accounts : [])
})
const el = { addEventListener() {}, textContent: '', className: '', querySelectorAll: () => [], querySelector: () => null }
globalThis.document = { getElementById: () => el, createElement: () => el, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }

// суммы ищем без разделителей (ru-RU ставит узкий/неразрывный пробел)
const flat = (s) => String(s).replace(/[\s\u00a0\u202f]/g, '')
const money = (html, v) => flat(html).includes(flat(v))

let bad = 0
const check = (name, ok) => { console.log(`${ok ? '✔' : '✘'} ${name}`); if (!ok) bad++ }

const accountView = await import(`${ROOT}/ui/js/views/accounts.js`)
const root = { innerHTML: '', querySelectorAll: () => [] }
await accountView.render(root)
const html = root.innerHTML
check('список счетов: реальный остаток (999,50)', money(html, '999,50'))
check('список счетов: подпись «сверен 14.09.2026»', html.includes('сверен 14.09.2026'))
check('список счетов: подпись «без сверки»', html.includes('без сверки'))
check('список счетов: кнопка «Сверить»', html.includes('data-action="reconcile"'))
check('список счетов: итог по currentBalance (1049,50)', money(html, '1049,50'))
check('список счетов: архив', html.includes('Архив (1)'))

const dash = await import(`${ROOT}/ui/js/views/dashboard.js`)
const root2 = { innerHTML: '' }
await dash.render(root2)
check('дашборд: «На картах» по currentBalance (1049,50)', money(root2.innerHTML, '1049,50'))

process.exit(bad ? 1 : 0)
EOF

if node "$TMP/ui.js" "$ROOT" >"$TMP/ui.out" 2>&1; then
  pass "доп) UI-шаблоны рендерятся и показывают currentBalance"
  while IFS= read -r line; do printf '     %s\n' "$line"; done < "$TMP/ui.out"
else
  fail "доп) UI-шаблоны: $(cat "$TMP/ui.out")"
fi

# --- нормализация даты операции (MAJOR-1) -----------------------------------
step "h) Дата операции нормализуется до календарного дня (MAJOR-1)"
# Дата-время клиента: SQLite date() уводит день в UTC (завтра 01:00+04:00 → сегодня 21:00),
# а гейт 409 видел бы исходный день — из-за расхождения операция молча выпадала из остатка.
TX_DT="${TOMORROW}T01:00:00+04:00"
say "счёт фиксируется на $TODAY, операция датирована $TX_DT → ожидаемый день $TOMORROW"

CODE=$(curl -s -o "$TMP/h1.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Verify Date Account\",\"type\":\"debit\",\"balance\":100000,\"balanceAsOf\":\"$TODAY\"}")
eq "h) POST /api/accounts с balanceAsOf=$TODAY → 201" "201" "$CODE"
eq "h) balanceAsOf сохранён" "$TODAY" "$(J balanceAsOf "$TMP/h1.json")"
HID=$(J id "$TMP/h1.json")
if [ -z "$HID" ] || [ "$HID" = "null" ]; then
  fail "h) не удалось получить id счёта: $(cat "$TMP/h1.json")"
  printf '\nИТОГ: FAIL (%d провалов)\n' "$FAIL"
  exit 1
fi

# (1) битая дата: 400 invalid_date, операция не записана
CODE=$(curl -s -o "$TMP/h2.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$HID\",\"type\":\"expense\",\"amount\":500,\"date\":\"10.09.2026\"}")
eq "h1) POST транзакции с датой 10.09.2026 → 400" "400" "$CODE"
eq "h1) error" "invalid_date" "$(J error "$TMP/h2.json")"
eq "h1) field" "date" "$(J field "$TMP/h2.json")"
curl -s "$API/transactions?accountId=$HID&limit=500" -o "$TMP/h3.json"
eq "h1) битая дата не записана (операций у счёта)" "0" "$(J length "$TMP/h3.json")"
curl -s "$API/accounts/$HID" -o "$TMP/h4.json"
eq "h1) currentBalance не изменился" "100000" "$(J currentBalance "$TMP/h4.json")"

# (2) дата-время: 201, в БД календарный день, операция ВХОДИТ в currentBalance
CODE=$(curl -s -o "$TMP/h5.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$HID\",\"type\":\"expense\",\"amount\":500,\"date\":\"$TX_DT\"}")
eq "h2) POST транзакции с датой $TX_DT → 201" "201" "$CODE"
TX_DT_ID=$(J id "$TMP/h5.json")
curl -s "$API/transactions/$TX_DT_ID" -o "$TMP/h6.json"
eq "h2) в БД сохранён календарный день" "$TOMORROW" "$(J date "$TMP/h6.json")"
curl -s "$API/accounts/$HID" -o "$TMP/h7.json"
eq "h2) зафиксированный balance не тронут" "100000" "$(J balance "$TMP/h7.json")"
eq "h2) операция входит в currentBalance (100000−500)" "99500" "$(J currentBalance "$TMP/h7.json")"

# дата-время внутри дня фиксации — гейт и формула сравнивают один и тот же день
CODE=$(curl -s -o "$TMP/h8.json" -w '%{http_code}' -X POST "$API/transactions" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"$HID\",\"type\":\"expense\",\"amount\":500,\"date\":\"${TODAY}T01:00:00+04:00\"}")
eq "h3) дата-время внутри дня фиксации → 409" "409" "$CODE"
eq "h3) date в 409 — нормализованный день" "$TODAY" "$(J date "$TMP/h8.json")"

# (5) 409-подсказка: у обоих вариантов есть явный эффект (MINOR-4)
eq "h4) hint.options[0].effect" "операция уже учтена в зафиксированном остатке — повторно вносить её не нужно" "$(J hint.options.0.effect "$TMP/h8.json")"
eq "h4) hint.options[1].effect" "фиксация сдвинется, операция попадёт в расчёт как новая" "$(J hint.options.1.effect "$TMP/h8.json")"
eq "h4) hint.options[0].action" "reconcile" "$(J hint.options.0.action "$TMP/h8.json")"
eq "h4) hint.options[1].action" "move_balance_as_of" "$(J hint.options.1.action "$TMP/h8.json")"

# (3) PATCH: битая дата отклоняется, правка комментария без date проходит
CODE=$(curl -s -o "$TMP/h9.json" -w '%{http_code}' -X PATCH "$API/transactions/$TX_DT_ID" \
  -H 'Content-Type: application/json' -d '{"date":"10.09.2026"}')
eq "h5) PATCH транзакции на битую дату → 400" "400" "$CODE"
eq "h5) error" "invalid_date" "$(J error "$TMP/h9.json")"
curl -s "$API/transactions/$TX_DT_ID" -o "$TMP/h10.json"
eq "h5) дата в БД не изменилась" "$TOMORROW" "$(J date "$TMP/h10.json")"
CODE=$(curl -s -o "$TMP/h11.json" -w '%{http_code}' -X PATCH "$API/transactions/$TX_DT_ID" \
  -H 'Content-Type: application/json' -d '{"comment":"правка без date"}')
eq "h5) PATCH комментария без date → 200" "200" "$CODE"
eq "h5) комментарий применён" "правка без date" "$(J comment "$TMP/h11.json")"
CODE=$(curl -s -o "$TMP/h12.json" -w '%{http_code}' -X PATCH "$API/transactions/$TX_DT_ID" \
  -H 'Content-Type: application/json' -d "{\"date\":\"$TX_DT\"}")
eq "h5) PATCH с датой-временем → 200" "200" "$CODE"
eq "h5) PATCH сохранил календарный день" "$TOMORROW" "$(J date "$TMP/h12.json")"

# --- валидация balanceAsOf при создании счёта (MAJOR-2) ---------------------
step "h6) POST /api/accounts валидирует balanceAsOf (MAJOR-2)"
CODE=$(curl -s -o "$TMP/h13.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bad Asof banana","type":"debit","balance":1000,"balanceAsOf":"banana"}')
eq "h6) balanceAsOf=\"banana\" → 400" "400" "$CODE"
eq "h6) error" "invalid_balance_as_of" "$(J error "$TMP/h13.json")"
eq "h6) field" "balanceAsOf" "$(J field "$TMP/h13.json")"

CODE=$(curl -s -o "$TMP/h13b.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Bad Asof future\",\"type\":\"debit\",\"balance\":1000,\"balanceAsOf\":\"$TOMORROW\"}")
eq "h6) будущая дата фиксации → 400" "400" "$CODE"
eq "h6) error" "invalid_balance_as_of" "$(J error "$TMP/h13b.json")"

CODE=$(curl -s -o "$TMP/h14.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asof empty","type":"debit","balance":1000,"balanceAsOf":""}')
eq "h6) balanceAsOf=\"\" → 201 (фиксации нет)" "201" "$CODE"
eq "h6) balanceAsOf = null" "null" "$(J balanceAsOf "$TMP/h14.json")"
eq "h6) currentBalance" "1000" "$(J currentBalance "$TMP/h14.json")"
EID=$(J id "$TMP/h14.json")
if [ -n "$EID" ] && [ "$EID" != "null" ]; then
  # фиксации нет — инкрементальное поведение сохранилось
  CODE=$(curl -s -o "$TMP/h14b.json" -w '%{http_code}' -X POST "$API/transactions" \
    -H 'Content-Type: application/json' \
    -d "{\"accountId\":\"$EID\",\"type\":\"expense\",\"amount\":100,\"date\":\"$YESTERDAY\"}")
  eq "h6) операция вне фиксации → 201" "201" "$CODE"
  curl -s "$API/accounts/$EID" -o "$TMP/h14c.json"
  eq "h6) currentBalance (инкрементально)" "900" "$(J currentBalance "$TMP/h14c.json")"
else
  fail "h6) счёт с balanceAsOf=\"\" не создан: $(cat "$TMP/h14.json")"
fi

CODE=$(curl -s -o "$TMP/h15.json" -w '%{http_code}' -X POST "$API/accounts" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Asof valid\",\"type\":\"debit\",\"balance\":1000,\"balanceAsOf\":\"$WEEK_AGO\"}")
eq "h6) валидная дата фиксации → 201" "201" "$CODE"
eq "h6) balanceAsOf сохранён" "$WEEK_AGO" "$(J balanceAsOf "$TMP/h15.json")"
eq "h6) currentBalance" "1000" "$(J currentBalance "$TMP/h15.json")"

# отклонённые счета не созданы и «замороженных» счетов в БД нет
curl -s "$API/accounts" -o "$TMP/h16.json"
eq "h6) отклонённые счета не созданы" "0" "$(node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
process.stdout.write(String(rows.filter(r => String(r.name).startsWith("Bad Asof")).length))
' "$TMP/h16.json")"
eq "h6) счетов с невалидным balanceAsOf" "0" "$(node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
process.stdout.write(String(rows.filter(r => r.balanceAsOf != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.balanceAsOf))).length))
' "$TMP/h16.json")"

# --- UI: селектор счёта в форме операции (MINOR-3) ---------------------------
step "h7) UI: форма операции показывает реальный остаток (MINOR-3)"
if grep -q 'rub(a\.currentBalance ?? a\.balance)' ui/js/views/transactions.js; then
  pass "h7) селектор счёта использует currentBalance"
else
  fail "h7) селектор счёта показывает зафиксированный balance: $(grep -n 'accountOptions = ' ui/js/views/transactions.js)"
fi

# ---------------------------------------------------------------------------
printf '\n────────────────────────────────────────\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mPASS\033[0m: %d проверок пройдено, 0 провалов\n' "$PASS"
  exit 0
else
  printf '\033[31mFAIL\033[0m: провалов %d, пройдено %d\n' "$FAIL" "$PASS"
  exit 1
fi
