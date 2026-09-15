#!/usr/bin/env bash
#
# Детерминированная end-to-end проверка импорта Альфа-выписок.
#
# Сценарий (всё на временной БД, рабочая data/finans.db не трогается):
#   1. Поднять пустую БД, прогнать все миграции.
#   2. Засеять счёт «Альфа (На продукты)» + карту 220015++++++4795.
#   3. Сгенерировать PDF из синтетической выписки (4 операции).
#   4. Прогнать preview → 4 операции с категориями по правилам.
#   5. Прогнать import → 4 created, 0 skipped.
#   6. Повторно preview → alreadyImported=4.
#   7. Повторно import → 0 created, 4 skipped (дедуп).
#   8. Проверить баланс счёта: было 100000 коп, расход -35-250-1500=-1785 коп,
#      приход +5000 коп → итого 100000 - 1785 + 5000 = 103215 коп.
#   9. Проверить количество и знак транзакций в БД.
#
# Прогон: ./bin/test-import-flow.sh

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d /tmp/finans-import.XXXXXX)"
DB="$TMP/test.db"
PDF="$TMP/statement.pdf"
RUNNER_JSON="$TMP/runner.json"

PASS=0
FAIL=0
step() { printf '\n%s\n' "$1"; }
pass() { PASS=$((PASS + 1)); printf '  \033[32m✓x ✓ PASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[31m✘ ✘ FAIL\033[0m  %s\n' "$1"; }

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# 1. Миграции на пустой БД.
step "1. Миграции на временной БД"
if FINANS_DB="$DB" node backend/src/migrate.js >"$TMP/migrate.log" 2>&1; then
  pass "миграции применены (включая 013_import_rules)"
else
  fail "миграции не применились: $(cat "$TMP/migrate.log")"
  exit 1
fi

# 2. Генерируем PDF из фикстуры.
step "2. Генерация PDF из синтетической выписки"
TEXT='ВЫПИСКА ПО СЧЁТУ
Период: 12.11.2025 — 15.11.2025
Счёт: 40817***0123 RUB

12.11.2025  CRD_9643H4  Операция по карте: 220015++++++4795, на сумму: 35.00 RUR, дата совершения 11.11.2025
                  32410885\RU\MOSCOW\DOSTAVKA IZ PYATEROCH MCC5411
                                                        -35,00 RUR
13.11.2025  CRD_9644A1  Операция по карте: 220015++++++4795, на сумму: 250.00 RUR, дата совершения 12.11.2025
                  32410886\RU\MOSCOW\KVARTAL MCC5812
                                                        -250,00 RUR
14.11.2025  CRD_9645B2  Операция по карте: 220015++++++4795, на сумму: 1500.00 RUR, дата совершения 13.11.2025
                  32410887\RU\MOSCOW\TATNEFT AZS 611 MCC5541
                                                        -1500,00 RUR
15.11.2025  CRD_9646C3  Перевод на счёт: 220015++++++4795, на сумму: 5000.00 RUR
                  99999\RU\MOSCOW\SBER BANK ONL MCC4829
                                                        +5000,00 RUR

ИТОГО РАСХОДОВ: 1785,00 RUR
ИТОГО ПРИХОДОВ: 5000,00 RUR'

if TEXT="$TEXT" node backend/bin/_generate-pdf.js "$PDF" >"$TMP/pdf.log" 2>&1; then
  SIZE=$(stat -f %z "$PDF" 2>/dev/null || stat -c %s "$PDF")
  pass "PDF создан ($SIZE байт)"
else
  fail "PDF не создан: $(cat "$TMP/pdf.log")"
  exit 1
fi

# 3. Сидим account + card через отдельный node-процесс.
step "3. Сидинг счёта «Альфа (На продукты)» + карта"
ACCOUNT_JSON='{"name":"Альфа (На продукты)","bank":"Alfa","type":"debit","balance":100000,"cards":[{"panMask":"220015++++++4795","label":"На продукты"}]}'
if FINANS_DB="$DB" node -e "
import('./backend/src/db.js').then(async ({ default: db }) => {
  const { v4: uuid } = await import('uuid');
  const a = $ACCOUNT_JSON;
  const id = uuid();
  db.prepare(\`INSERT INTO accounts (id, name, bank, type, currency, balance, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, 'RUB', ?, ?, ?)\`)
    .run(id, a.name, a.bank, a.type, a.balance, new Date().toISOString(), new Date().toISOString());
  for (const c of a.cards) {
    db.prepare('INSERT INTO account_cards (id, accountId, panMask, label) VALUES (?, ?, ?, ?)')
      .run(uuid(), id, c.panMask, c.label || null);
  }
  process.stdout.write(id);
});
" > "$TMP/account_id.txt" 2>"$TMP/seed.err"; then
  ACCOUNT_ID=$(cat "$TMP/account_id.txt")
  pass "счёт создан: $ACCOUNT_ID"
else
  fail "seed не удался: $(cat "$TMP/seed.err")"
  exit 1
fi

# 4. Runner: preview + import + re-preview + re-import.
step "4. Runner: preview → import → re-preview → re-import"
CMD=$(printf '{"pdfPath":"%s","import":[{"externalRef":"CRD_9643H4","accountId":"%s","date":"2025-11-12","type":"expense","amount":3500,"mcc":"5411","merchantName":"DOSTAVKA IZ PYATEROCH"},{"externalRef":"CRD_9644A1","accountId":"%s","date":"2025-11-13","type":"expense","amount":25000,"mcc":"5812","merchantName":"KVARTAL"},{"externalRef":"CRD_9645B2","accountId":"%s","date":"2025-11-14","type":"expense","amount":150000,"mcc":"5541","merchantName":"TATNEFT AZS 611"},{"externalRef":"CRD_9646C3","accountId":"%s","date":"2025-11-15","type":"income","amount":500000,"mcc":"4829","merchantName":"SBER BANK ONL"}]}' "$PDF" "$ACCOUNT_ID" "$ACCOUNT_ID" "$ACCOUNT_ID" "$ACCOUNT_ID")

if printf '%s' "$CMD" | FINANS_DB="$DB" node backend/bin/_import-flow-runner.js >"$RUNNER_JSON" 2>"$TMP/runner.err"; then
  pass "runner отработал"
else
  fail "runner упал: $(cat "$TMP/runner.err")"
  exit 1
fi

# 4. Проверки.
step "5. Проверки результата"

FOUND=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).preview.totals.found)")
[ "$FOUND" = "4" ] && pass "preview: найдено 4 операции" || fail "preview: ожидалось 4 операции, получено $FOUND"

# Категории по правилам MCC.
CAT_5411=$(node -e "
const j = JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8'));
const op = j.preview.operations.find(o => o.mcc === '5411');
console.log(op.suggestedCategoryId || 'null');
")
# После сида в runner мы не знаем id категории «Продукты» напрямую — проверяем, что suggestedCategoryId не null.
if [ "$CAT_5411" != "null" ] && [ -n "$CAT_5411" ]; then
  pass "preview: MCC 5411 (Продукты) получил категорию ($CAT_5411)"
else
  fail "preview: MCC 5411 не получил категорию"
fi

# Дедуп на повторном preview.
ALREADY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).replayPreview.totals.alreadyImported)")
[ "$ALREADY" = "4" ] && pass "повторный preview: alreadyImported=4 (дедуп по externalRef)" || fail "повторный preview: ожидалось alreadyImported=4, получено $ALREADY"

# Import: 4 created, 0 skipped.
CREATED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).importResult.created)")
SKIPPED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).importResult.skipped)")
[ "$CREATED" = "4" ] && [ "$SKIPPED" = "0" ] && pass "первый import: created=4, skipped=0" || fail "первый import: ожидалось created=4/skipped=0, получено created=$CREATED skipped=$SKIPPED"

# Повторный import: 0 created, 4 skipped.
RECREATED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).reimportResult.created)")
RESKIPPED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).reimportResult.skipped)")
[ "$RECREATED" = "0" ] && [ "$RESKIPPED" = "4" ] && pass "повторный import: created=0, skipped=4" || fail "повторный import: ожидалось created=0/skipped=4, получено created=$RECREATED skipped=$RESKIPPED"

# Баланс: начальный 100000 коп (1000 руб). JSON импорта передаёт amount в копейках:
#  -3500 (35 руб) -25000 (250 руб) -150000 (1500 руб) +500000 (5000 руб) = +321500 коп.
# Итого: 100000 + 321500 = 421500 коп = 4215 руб.
BALANCE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).state.accounts[0].balance)")
[ "$BALANCE" = "421500" ] && pass "баланс счёта после импорта = 421500 коп (1000 ₽ + 3215 ₽)" || fail "баланс: ожидалось 421500, получено $BALANCE"

# Количество транзакций = 4.
TXCOUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RUNNER_JSON','utf8')).state.txCount)")
[ "$TXCOUNT" = "4" ] && pass "в БД 4 транзакции (без дублей)" || fail "ожидалось 4 транзакции, получено $TXCOUNT"

# Источник всех транзакций — 'import'.
SRC_OK=$(FINANS_DB="$DB" node -e "
const db = require('better-sqlite3')('$DB', { readonly: true });
const rows = db.prepare(\"SELECT source, COUNT(*) as c FROM transactions GROUP BY source\").all();
process.stdout.write(JSON.stringify(rows));
")
echo "$SRC_OK" | grep -q '"source":"import","c":4' && pass "все 4 транзакции имеют source='import'" || fail "source транзакций: $SRC_OK"

# У одной из них externalRef = CRD_9643H4.
EXT_OK=$(FINANS_DB="$DB" node -e "
const db = require('better-sqlite3')('$DB', { readonly: true });
const row = db.prepare(\"SELECT externalRef FROM transactions WHERE externalRef = 'CRD_9643H4'\").get();
process.stdout.write(row ? row.externalRef : 'missing');
")
[ "$EXT_OK" = "CRD_9643H4" ] && pass "externalRef=CRD_9643H4 сохранён" || fail "externalRef: $EXT_OK"

echo ""
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mPASS\033[0m: %d проверок пройдено, 0 провалов\n' "$PASS"
  exit 0
else
  printf '\033[31mFAIL\033[0m: провалов %d, пройдено %d\n' "$FAIL" "$PASS"
  exit 1
fi