// Подписи и знак операции для списков (transactions.js, dashboard.js).
//
// Перемещение между своими счетами хранится как type='transfer', двумя ногами
// с общим externalRef: источник (transferDirection='out') и получатель ('in').
// Так пишут и импорт выписки, и ручное создание в UI. amount при этом всегда
// положительный — знак (и для баланса, и для отображения) даёт type +
// transferDirection (см. backend/src/balance.js).
// Ветка source==='transfer' оставлена как защита от легаси-строк.
const TYPE_LABEL = { expense: 'Расход', income: 'Доход', transfer: 'Перемещение' }

export function isTransfer(tx) {
  return !!tx && (tx.type === 'transfer' || tx.source === 'transfer')
}

// Ключ для CSS-класса бейджа: badge-${key}. У перемещения — badge-transfer,
// чтобы нейтральный бейдж не путался с красно-зелёной парой доход/расход.
export function transactionTypeKey(tx) {
  return isTransfer(tx) ? 'transfer' : tx.type
}

export function transactionTypeLabel(tx) {
  return TYPE_LABEL[transactionTypeKey(tx)] || tx.type
}

// Знаковая сумма для отображения: расход и transfer-out — минус, доход и
// transfer-in — плюс. Нужна, потому что у transfer amount положителен, а
// направление лежит отдельно.
export function transactionSignedAmount(tx) {
  if (!tx) return 0
  const amount = Number(tx.amount) || 0
  if (tx.type === 'expense') return -amount
  if (tx.type === 'income') return amount
  if (isTransfer(tx)) {
    if (tx.transferDirection === 'out') return -amount
    if (tx.transferDirection === 'in') return amount
  }
  return amount
}
