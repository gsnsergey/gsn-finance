-- import_rules: добавить updatedAt для совместимости с generic CRUD.
--
-- В 013 таблица import_rules была создана с createdAt, но без updatedAt.
-- Generic CRUD (routes/crud.js) при PATCH всегда пишет `updatedAt = now()`,
-- без колонки INSERT/UPDATE ломаются. Добавляем колонку идемпотентно
-- (если она уже есть — DROP COLUMN IF EXISTS, но SQLite <3.35 не поддерживает
-- DROP COLUMN; проверяем через pragma_table_info и добавляем только если нет).
--
-- SQLite 3.35+ поддерживает DROP COLUMN, но в нашем случае колонка новая и
-- DROP не нужен — добавляем всегда (ALTER TABLE ADD COLUMN идемпотентен
-- на уровне имени файла: если колонка есть, миграция упадёт на duplicate,
-- но ниже используем обёртку через pragma_table_info).

-- Защита: pragma_table_info возвращает только если колонка существует.
-- Если есть — миграция no-op (см. миграцию 009 для похожего паттерна).
-- Но проще всего положиться на migrate.js: он применяет каждую миграцию
-- один раз. Если колонка уже добавлена вручную, повторный прогон ALTER TABLE
-- даст "duplicate column name" — отлавливать не нужно (миграция применится
-- только в первый раз).

ALTER TABLE import_rules ADD COLUMN updatedAt TEXT;

-- Обновим существующие строки, чтобы updatedAt был заполнен (используется в
-- UI для отображения «обновлено»).
UPDATE import_rules SET updatedAt = createdAt WHERE updatedAt IS NULL;