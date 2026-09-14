-- broker_credentials: хранение API-токенов брокеров (Т-Инвестиции, БКС, ...)
-- в БД, зашифрованных мастер-ключом из data/.encryption.key (см. lib/secretStore.js).
--
-- Модель: один токен на пару (provider, brokerAccountId). Для Т-Инвестиций
-- токен один на пользователя Тинькофф, но привязан к нескольким broker
-- accounts — для каждой пары отдельная запись (одинаковый tokenCiphertext,
-- разные brokerAccountId). Это единая модель для всех провайдеров.
--
-- В API токен возвращается ТОЛЬКО при POST/PATCH (echo новой записи целиком),
-- в GET-list — маска `••••••••XXXX` (последние 4 символа), чтобы токен
-- не «протекал» через UI.

CREATE TABLE broker_credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('tinkoff','bcs','finam','other')),
  brokerAccountId TEXT NOT NULL,
  label TEXT,
  tokenCiphertext TEXT NOT NULL,            -- base64(iv || ciphertext || authTag) от AES-256-GCM
  lastUsedAt TEXT,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(provider, brokerAccountId)
);
CREATE INDEX idx_broker_credentials_provider ON broker_credentials(provider);