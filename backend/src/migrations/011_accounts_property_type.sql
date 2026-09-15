-- accounts.type: добавить 'property' (недвижимость и прочее имущество).
--
-- Зачем: net worth считает активы как SUM(accounts.currentBalance) +
-- deposits + holdings. Без недвижимости капитал структурно отрицательный
-- (ипотека есть, квартиры в активах нет). Тип 'property' позволяет учесть
-- имущество в активах, не смешивая его с банковскими счетами на уровне модели.
--
-- SQLite не умеет менять CHECK-ограничение на месте, поэтому таблица
-- пересоздаётся каноническим способом: новая таблица → копирование строк →
-- DROP старой → RENAME. Порядок и типы колонок сохранены как в текущей
-- схеме (balanceAsOf в конце — добавлена 005_account_balance_as_of.sql).
--
-- ВАЖНО: DROP TABLE родителя при включённых FK каскадно удалил бы дочерние
-- строки (account_cards и transactions объявлены ON DELETE CASCADE).
-- PRAGMA foreign_keys внутри транзакции — no-op, поэтому migrate.js выключает
-- FK на время прогона миграций и включает обратно после (плюс foreign_key_check).
-- Данные (archived, balanceAsOf, карты, операции) при этом сохраняются.

CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT,
  type TEXT NOT NULL CHECK(type IN ('debit', 'credit', 'card', 'savings', 'property')),
  currency TEXT NOT NULL DEFAULT 'RUB',
  balance INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  balanceAsOf TEXT
);

INSERT INTO accounts_new (id, name, bank, type, currency, balance, color, archived, createdAt, updatedAt, balanceAsOf)
SELECT id, name, bank, type, currency, balance, color, archived, createdAt, updatedAt, balanceAsOf
  FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX idx_accounts_archived ON accounts(archived);
