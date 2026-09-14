-- Карты, привязанные к счёту (только маска PAN, не полный номер).
--
-- Сценарий: у одного счёта (особенно Альфа / Озон / Тинькофф) может быть
-- несколько карт: «На продукты», «Премиум», зарплатная, дополнительная для
-- семьи. Полный PAN не храним — храним маску вида `220015++++++4795`
-- (первые 6 и последние 4 цифры, середина закрыта).
--
-- Эта же таблица будет использоваться задачей импорта банковских выписок
-- (`feature-import-vypisok-banka-i-mapping-v-kategorii.md`): Альфа в выписке
-- даёт маску карты → по ней находим счёт → записываем операцию.
--
-- Валидация маски на уровне приложения (UI и сервер): regex
-- `^\d{6}\+{4,}\d{4}$`. Полный PAN из 16 цифр без плюсов отвергается.
--
-- ON DELETE CASCADE: при удалении счёта связанные карты удаляются автоматом.

CREATE TABLE account_cards (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  panMask TEXT NOT NULL,
  label TEXT,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE(accountId, panMask)
);
CREATE INDEX idx_account_cards_account ON account_cards(accountId);