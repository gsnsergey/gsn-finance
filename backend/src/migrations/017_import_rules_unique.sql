-- Дедупликация правил маппинга + защита от повторного создания одного и того же
-- правила. См. .tasks/... / диагностику дублей 2026-09-15.
--
-- Причина: экран импорта (ui/js/views/import.js, чекбокс «Сохранить как правило
-- для MCC») и generic CRUD POST /api/import-rules безусловно вставляли новую
-- строку при каждом импорте. UNIQUE-ограничения в 013 не было, поэтому на
-- рабочей БД накопилось 20 дублей в 5 группах (4131×8, 5499×6, 5300×2,
-- 7542×2, 5912×2 — последний ещё и с разными категориями).
--
-- Комментарий в import.js обещал дедуп, но проверки в коде не было; catch
-- вокруг POST ловил `UNIQUE`, которого не существовало.

-- 1. Удаляем дубли, оставляя самое раннее правило группы (MIN(rowid)).
--    Группа = (matchType, matchValue, accountId), где NULL приводится к ''.
DELETE FROM import_rules
 WHERE rowid NOT IN (
   SELECT MIN(rowid)
     FROM import_rules
    GROUP BY matchType, matchValue, COALESCE(accountId, '')
 );

-- 2. UNIQUE-индекс на ту же группу. COALESCE обязателен: в SQLite NULL не
--    конфликтует с NULL в UNIQUE, поэтому без него глобальные правила
--    (accountId IS NULL) по-прежнему дублировались бы.
CREATE UNIQUE INDEX idx_import_rules_unique
    ON import_rules (matchType, matchValue, COALESCE(accountId, ''));
