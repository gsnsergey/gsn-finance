// Справочник валют. value — ISO 4217 код, label — человекочитаемое название.

export const CURRENCIES = [
  { value: 'RUB', label: 'Российский рубль', symbol: '₽' },
  { value: 'USD', label: 'Доллар США', symbol: '$' },
  { value: 'EUR', label: 'Евро', symbol: '€' },
  { value: 'GBP', label: 'Британский фунт', symbol: '£' },
  { value: 'CNY', label: 'Китайский юань', symbol: '¥' },
  { value: 'JPY', label: 'Японская иена', symbol: '¥' },
  { value: 'CHF', label: 'Швейцарский франк', symbol: '₣' },
  { value: 'TRY', label: 'Турецкая лира', symbol: '₺' },
  { value: 'AED', label: 'Дирхам ОАЭ', symbol: 'د.إ' },
  { value: 'THB', label: 'Тайский бат', symbol: '฿' },
  { value: 'KZT', label: 'Казахстанский тенге', symbol: '₸' },
  { value: 'BYN', label: 'Белорусский рубль', symbol: 'Br' },
  { value: 'UAH', label: 'Украинская гривна', symbol: '₴' },
  { value: 'AMD', label: 'Армянский драм', symbol: '֏' },
  { value: 'GEL', label: 'Грузинский лари', symbol: '₾' },
  { value: 'BTC', label: 'Биткоин', symbol: '₿' },
  { value: 'ETH', label: 'Эфириум', symbol: 'Ξ' }
]

export const CURRENCY_VALUES = CURRENCIES.map(c => c.value)

// Возвращает название валюты по ISO-коду (или сам код, если не нашли).
export function currencyLabel(code) {
  if (!code) return '—'
  const c = CURRENCIES.find(x => x.value === code)
  return c ? c.label : code
}

// Возвращает символ валюты по ISO-коду (или сам код).
export function currencySymbol(code) {
  if (!code) return ''
  const c = CURRENCIES.find(x => x.value === code)
  return c ? c.symbol : code
}
