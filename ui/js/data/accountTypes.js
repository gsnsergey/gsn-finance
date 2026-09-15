// Типы банковских счетов / карт.
// Недвижимость — не счёт, у неё отдельная вкладка и модель (см. ui/js/data/propertyTypes.js).

export const ACCOUNT_TYPES = [
  { value: 'debit', label: 'Дебетовая карта' },
  { value: 'credit', label: 'Кредитная карта' },
  { value: 'card', label: 'Карта' },
  { value: 'savings', label: 'Накопительный' }
]

// Возвращает русское название типа по коду.
export function accountTypeLabel(code) {
  if (!code) return '—'
  const t = ACCOUNT_TYPES.find(x => x.value === code)
  return t ? t.label : code
}
