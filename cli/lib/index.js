import { commands } from './commands.js'
import { parseFlags } from './format.js'

const HELP = `
Finans CLI — управление личными финансами через терминал.

Использование:
  fin agent <команда> [--flag значение ...]

Переменные окружения:
  FINANS_API  базовый URL бэкенда (по умолчанию http://localhost:3737)

Основные команды:
  list-accounts                       список счетов
  add-account --name X --type debit   создать счёт
  reconcile-account --account X --balance 12000.50 [--as-of 2026-09-14]
                                      сверить остаток: фактический → фиксация на дату
  update-account --account X [--balance 12000.50] [--as-of 2026-09-10 | --clear-as-of]
                                      правка счёта: баланс = сверка на сегодня,
                                      --as-of сдвигает дату сверки, --clear-as-of снимает
  list-categories                     список категорий

  add-transaction --account "Tinkoff Black" --type expense --amount 1500 \\
                   [--category "Продукты"] [--date 2026-09-10] [--comment "..."]
  list-transactions [--month 2026-09] [--account X] [--type expense|income]

  add-deposit --bank sber --name X --principal 500000 --rate 8 --opened 2026-03-01 \\
               [--capitalization] [--payout end|monthly|quarterly]
  add-holding --broker tinkoff --ticker SBER --quantity 100 --avg-price 250 [--current-price 260]
  list-holdings
  add-loan --bank alfa --name X --principal 800000 --remaining 750000 \\
            --rate 12 --monthly 15000 --payment-day 15 --opened 2025-06-01 \\
            --type consumer|mortgage|credit_line
  add-subscription --name "Я.Плюс" --amount 299 --period monthly --next 2026-10-01
  list-subscriptions
  add-obligation --name "Аренда" --amount 30000 --period monthly --next 2026-10-05

  t-invest pull [--dry-run]            импорт портфеля из Т-Инвестиций (нужен TINKOFF_INVEST_TOKEN в data/.env)

  net-worth                           сводка по активам/обязательствам

Суммы везде указываются в рублях (например, --amount 1500 = 1500.00 ₽).
Вместо UUID можно передавать имя счёта или категории — CLI найдёт сам.

Сверка остатков:
  У счёта есть зафиксированный остаток на дату сверки (balanceAsOf); реальный
  остаток = зафиксированный + операции после этой даты. Операция с датой внутри
  зафиксированного периода отклоняется (409): сначала сверьте счёт заново
  (reconcile-account) либо сдвиньте дату сверки (update-account --as-of).
`

export async function main(argv) {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    console.log(HELP)
    return
  }

  if (argv[0] !== 'agent') {
    console.error(`Неизвестная группа команд: "${argv[0]}". Используй "fin agent".`)
    process.exit(1)
  }

  const name = argv[1]
  if (!name || name.startsWith('--')) {
    console.log(HELP)
    return
  }

  const cmd = commands[name]
  if (!cmd) {
    console.error(`Неизвестная команда: fin agent ${name}`)
    console.error(`\nДоступные команды:`)
    const names = Object.keys(commands).sort()
    for (const n of names) console.error(`  ${n}`)
    process.exit(1)
  }

  try {
    const flags = parseFlags(argv.slice(2))
    await cmd(flags)
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
}
