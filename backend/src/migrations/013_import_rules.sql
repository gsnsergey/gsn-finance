-- Импорт банковских выписок (Альфа) + маппинг операций в категории.
-- См. .tasks/in-progress/feature-import-vypisok-banka-i-mapping-v-kategorii.md
--
-- Эта миграция вводит таблицу правил маппинга import_rules и засевает
-- базовый словарь MCC → категория, чтобы первый импорт выписки дал хоть
-- какую-то категоризацию «из коробки».
--
-- account_cards (маски карт) уже создана в 007 — здесь только логика правил.
--
-- Категории ниже сидятся ВСЕ (а не только «Рестораны»/«Фастфуд»/«АЗС»/
-- «Сладости»/«Такси»), потому что migrate.js не запускает seed.js, и на
-- пустой БД (verify.sh, бутстрап) категорий нет — а наши правила MCC
-- ссылаются на них NOT NULL. WHERE NOT EXISTS делает вставку идемпотентной:
-- если категория с таким (name, type) уже есть (на живой БД её засеял
-- seed.js) — строка пропускается. ID генерируется через randomblob(16), а
-- не uuid(), чтобы не было дублей при повторном прогоне.

CREATE TABLE import_rules (
  id TEXT PRIMARY KEY,
  -- NULL = правило действует на все счета Альфы/банка. Когда NULL,
  -- правило глобальное и применяется к любой accountId в порядке priority.
  accountId TEXT,
  matchType TEXT NOT NULL CHECK(matchType IN ('mcc','merchantName','merchantId','descriptionRegex')),
  matchValue TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  -- Меньше число = выше приоритет. Точные правила (merchantName, merchantId)
  -- получают низкий priority (10), MCC-only — 100, regex-правила — 200.
  priority INTEGER NOT NULL DEFAULT 100,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_import_rules_account ON import_rules(accountId);
CREATE INDEX idx_import_rules_match ON import_rules(matchType, matchValue);
CREATE INDEX idx_import_rules_priority ON import_rules(priority);

-- Базовый словарь категорий (expense). Полный список — как в seed.js,
-- чтобы миграция самодостаточно работала на пустой БД. Идемпотентно.
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Продукты', 'expense', '#e74c3c', 'shopping-cart', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Продукты' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Транспорт', 'expense', '#3498db', 'car', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Транспорт' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Жильё', 'expense', '#9b59b6', 'home', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Жильё' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Коммуналка', 'expense', '#1abc9c', 'bolt', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Коммуналка' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Связь', 'expense', '#34495e', 'mobile', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Связь' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Здоровье', 'expense', '#e67e22', 'medkit', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Здоровье' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Кафе', 'expense', '#f39c12', 'coffee', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Кафе' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Одежда', 'expense', '#e91e63', 'tshirt', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Одежда' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Развлечения', 'expense', '#9c27b0', 'film', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Развлечения' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Подписки', 'expense', '#673ab7', 'tv', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Подписки' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Образование', 'expense', '#3f51b5', 'graduation-cap', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Образование' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Прочее', 'expense', '#95a5a6', 'tag', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Прочее' AND type = 'expense');

-- Категории для нового пресета MCC (импорт выписок).
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Рестораны', 'expense', '#d35400', 'cutlery', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Рестораны' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Фастфуд', 'expense', '#e67e22', 'flash', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Фастфуд' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'АЗС', 'expense', '#f39c12', 'gas', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'АЗС' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Сладости', 'expense', '#e91e63', 'birthday-cake', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Сладости' AND type = 'expense');
INSERT INTO categories (id, name, type, color, icon, archived, createdAt, updatedAt)
SELECT lower(hex(randomblob(16))), 'Такси', 'expense', '#3498db', 'taxi', 0, datetime('now'), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Такси' AND type = 'expense');

-- Базовый словарь MCC → категория. priority=100 — MCC-only правила, ниже
-- точных merchantName/merchantId (10), выше regex-фолбэков (200).
-- Глобальные правила (accountId IS NULL) применяются на все счета.
-- Идемпотентность: WHERE NOT EXISTS защищает от дублей при повторном
-- применении миграции (migrate.js всё равно применяет каждую миграцию
-- один раз, но защита дешёвая).
INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '5411',
       (SELECT id FROM categories WHERE name = 'Продукты' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '5411' AND accountId IS NULL
 );

INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '5812',
       (SELECT id FROM categories WHERE name = 'Рестораны' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '5812' AND accountId IS NULL
 );

INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '5814',
       (SELECT id FROM categories WHERE name = 'Фастфуд' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '5814' AND accountId IS NULL
 );

INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '5541',
       (SELECT id FROM categories WHERE name = 'АЗС' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '5541' AND accountId IS NULL
 );

INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '5441',
       (SELECT id FROM categories WHERE name = 'Сладости' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '5441' AND accountId IS NULL
 );

INSERT INTO import_rules (id, accountId, matchType, matchValue, categoryId, priority, createdAt)
SELECT lower(hex(randomblob(16))), NULL, 'mcc', '4121',
       (SELECT id FROM categories WHERE name = 'Такси' AND type = 'expense' LIMIT 1),
       100, datetime('now')
 WHERE NOT EXISTS (
   SELECT 1 FROM import_rules
    WHERE matchType = 'mcc' AND matchValue = '4121' AND accountId IS NULL
 );