// Справочник провайдеров брокеров (для хранения токенов в broker_credentials).
// Отличается от brokers.js тем, что broker-кодов МНОГО (Тинькофф, Сбер, БКС, Финам…),
// а провайдеров для token-storage — МАЛО: 1 провайдер ↔ 1 endpoint интеграции.

export const BROKER_PROVIDERS = [
  { value: 'tinkoff', label: 'Т-Инвестиции' },
  { value: 'bcs', label: 'БКС' },
  { value: 'finam', label: 'Финам' },
  { value: 'other', label: 'Другой' }
]

export function providerLabel(code) {
  return BROKER_PROVIDERS.find(p => p.value === code)?.label || code || '—'
}