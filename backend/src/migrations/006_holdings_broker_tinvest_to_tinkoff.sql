-- holdings: привести broker='t-invest' к канону 'tinkoff'.
--
-- Импорт Т-Инвестиций до фикса (commit f3f7984) писал broker='t-invest',
-- а в справочнике ui/js/data/brokers.js ключ 'tinkoff'. После фикса новые
-- записи идут корректно; эта миграция подтягивает старые.
--
-- Идемпотентная: повторный запуск ничего не изменит (нет строк под WHERE).
UPDATE holdings SET broker = 'tinkoff' WHERE broker = 't-invest';
