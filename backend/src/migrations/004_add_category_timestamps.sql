-- Категории были без createdAt/updatedAt. CRUD их использует — добавляем колонки.
ALTER TABLE categories ADD COLUMN createdAt TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN updatedAt TEXT NOT NULL DEFAULT '';

UPDATE categories SET createdAt = datetime('now'), updatedAt = datetime('now')
  WHERE createdAt = '';
