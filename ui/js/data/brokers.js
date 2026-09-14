// Справочник российских брокеров.

export const BROKERS = [
  { value: 'tinkoff', label: 'Т-Инвестиции (Тинькофф)' },
  // Алиас: до миграции 006 в holdings могли быть записи с broker='t-invest'
  // (legacy от ранней версии импорта). Запись нужна, чтобы brokerLabel('t-invest')
  // возвращал русское название, а не сырой код.
  // После миграции записей с broker='t-invest' не остаётся — алиас безвреден.
  { value: 't-invest', label: 'Т-Инвестиции (Тинькофф)' },
  { value: 'sberinvest', label: 'Сбер Инвестиции' },
  { value: 'bks', label: 'БКС' },
  { value: 'finam', label: 'Финам' },
  { value: 'alfa', label: 'Альфа-Инвестиции' },
  { value: 'vtb', label: 'ВТБ Инвестиции' },
  { value: 'gazprombank', label: 'Газпромбанк Инвестиции' },
  { value: 'psb', label: 'Промсвязьбанк Инвестиции' },
  { value: 'raiffeisen', label: 'Райффайзен Инвестиции' },
  { value: 'open', label: 'Открытие Инвестиции' },
  { value: 'kit', label: 'КИТ Финанс' },
  { value: 'atol', label: 'АТОЛ' },
  { value: 'ib', label: 'Interactive Brokers' }
]

export function brokerLabel(code) {
  if (!code) return '—'
  const b = BROKERS.find(x => x.value === code)
  return b ? b.label : code
}
