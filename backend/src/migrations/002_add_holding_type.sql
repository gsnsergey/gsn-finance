-- Добавляем тип актива в holdings
ALTER TABLE holdings ADD COLUMN type TEXT NOT NULL DEFAULT 'stock'
  CHECK(type IN ('stock', 'etf', 'fund', 'bond_ofz', 'bond_corp', 'eurobond', 'future', 'option', 'metal', 'crypto', 'other'));
