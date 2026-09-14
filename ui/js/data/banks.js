// Справочник банков России.
// value — короткий код, который сохраняется в БД (и используется CLI: --bank sber).
// label — человекочитаемое название для UI.

export const BANKS = [
  { value: 'sber', label: 'Сбербанк (Сбер)' },
  { value: 'tbank', label: 'Т-Банк (Тинькофф)' },
  { value: 'alfa', label: 'Альфа-Банк' },
  { value: 'tochka', label: 'Точка' },
  { value: 'ozon', label: 'Озон Банк' },
  { value: 'bks', label: 'БКС' },
  { value: 'yandex', label: 'Яндекс Банк' },
  { value: 'vtb', label: 'ВТБ' },
  { value: 'raiffeisen', label: 'Райффайзенбанк' },
  { value: 'gazprombank', label: 'Газпромбанк' },
  { value: 'rshb', label: 'Россельхозбанк' },
  { value: 'open', label: 'Открытие' },
  { value: 'mts', label: 'МТС Банк' },
  { value: 'sovcombank', label: 'Совкомбанк' },
  { value: 'psb', label: 'Промсвязьбанк' },
  { value: 'akbars', label: 'Ак Барс' },
  { value: 'homecredit', label: 'Хоум Кредит' },
  { value: 'rencredit', label: 'Ренессанс Кредит' },
  { value: 'uralsib', label: 'Уралсиб' },
  { value: 'citibank', label: 'Ситибанк' },
  { value: 'ingos', label: 'Ингосстрах Банк' },
  { value: 'tcs', label: 'Тинькофф Кредитные Системы (старое)' }
]

// Только коды для <datalist><option value=...>
export const BANK_VALUES = BANKS.map(b => b.value)

// Возвращает русское название банка по коду (или сам код, если не нашли).
export function bankLabel(code) {
  if (!code) return '—'
  const b = BANKS.find(x => x.value === code)
  return b ? b.label : code
}
