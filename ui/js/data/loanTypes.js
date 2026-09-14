// Типы кредитов.

export const LOAN_TYPES = [
  { value: 'consumer', label: 'Потребительский' },
  { value: 'mortgage', label: 'Ипотека' },
  { value: 'credit_line', label: 'Кредитная линия' }
]

export function loanTypeLabel(code) {
  if (!code) return '—'
  const t = LOAN_TYPES.find(x => x.value === code)
  return t ? t.label : code
}
