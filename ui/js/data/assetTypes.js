// Типы активов в портфеле. value — код в БД, label — русское название.

export const ASSET_TYPES = [
  { value: 'stock', label: 'Акция' },
  { value: 'etf', label: 'ETF / БПИФ' },
  { value: 'fund', label: 'Паевой фонд (ПИФ)' },
  { value: 'bond_ofz', label: 'ОФЗ' },
  { value: 'bond_corp', label: 'Корпоративная облигация' },
  { value: 'eurobond', label: 'Еврооблигация' },
  { value: 'future', label: 'Фьючерс' },
  { value: 'option', label: 'Опцион' },
  { value: 'metal', label: 'Драгоценный металл' },
  { value: 'crypto', label: 'Криптовалюта' },
  { value: 'other', label: 'Другое' }
]

export function assetTypeLabel(code) {
  if (!code) return '—'
  const t = ASSET_TYPES.find(x => x.value === code)
  return t ? t.label : code
}
