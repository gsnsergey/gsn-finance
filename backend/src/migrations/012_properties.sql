-- Недвижимость: вынести из accounts в отдельную таблицу properties.
--
-- Контекст: в 011 тип 'property' был добавлен в accounts, но имущество — не
-- банковский счёт: у него нет операций, карт и сверки остатка, и в UI оно должно
-- жить на отдельной вкладке «Недвижимость», а не в «Счетах и картах».
-- Поэтому:
--   1) создаём properties (тип, адрес, оценочная стоимость, дата покупки, заметка);
--   2) переносим туда уже заведённые accounts.type='property';
--   3) возвращаем CHECK accounts.type к debit/credit/card/savings.
--
-- Пересоздание accounts — по той же схеме, что в 011: FK на время миграции
-- выключен в migrate.js, поэтому account_cards и transactions не теряются.

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK(type IN ('apartment', 'house', 'land', 'garage', 'commercial', 'other')),
  address TEXT,
  -- Оценочная стоимость в копейках (как все деньги в проекте).
  value INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  purchasedAt TEXT,
  comment TEXT,
  color TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_properties_archived ON properties(archived);

-- Перенос ранее заведённых имущественных «счетов». Тип ставим 'other' —
-- в accounts конкретный вид имущества не хранился; уточняется вручную.
INSERT INTO properties (id, name, type, address, value, currency, purchasedAt, comment, color, archived, createdAt, updatedAt)
SELECT id, name, 'other', NULL, balance, currency, NULL, 'Перенесено из счетов (миграция 012)', color, archived, createdAt, updatedAt
  FROM accounts
 WHERE type = 'property';

CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT,
  type TEXT NOT NULL CHECK(type IN ('debit', 'credit', 'card', 'savings')),
  currency TEXT NOT NULL DEFAULT 'RUB',
  balance INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  balanceAsOf TEXT
);

-- Копируем только настоящие банковские счета: строки type='property' уже
-- перенесены в properties выше и в новой схеме accounts недопустимы.
INSERT INTO accounts_new (id, name, bank, type, currency, balance, color, archived, createdAt, updatedAt, balanceAsOf)
SELECT id, name, bank, type, currency, balance, color, archived, createdAt, updatedAt, balanceAsOf
  FROM accounts
 WHERE type <> 'property';

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX idx_accounts_archived ON accounts(archived);
