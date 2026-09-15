// Типы недвижимости и прочего имущества.

export const PROPERTY_TYPES = [
  { value: 'apartment', label: 'Квартира' },
  { value: 'house', label: 'Дом / дача' },
  { value: 'land', label: 'Земельный участок' },
  { value: 'garage', label: 'Гараж / машиноместо' },
  { value: 'commercial', label: 'Коммерческая' },
  { value: 'other', label: 'Прочее' }
]

export function propertyTypeLabel(code) {
  if (!code) return '—'
  const t = PROPERTY_TYPES.find(x => x.value === code)
  return t ? t.label : code
}
