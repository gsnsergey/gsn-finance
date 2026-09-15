-- Направление перевода между своими счетами (transferDirection).
--
-- Зачем:
--   Импортированные переводы (type='transfer') исторически НЕ двигали балансы:
--   signedDelta/CURRENT_BALANCE_EXPR отдавали для transfer 0. Из-за этого
--   транзитный «Альфа (Основной)» показывал валовой приход 351 999,23 ₽, хотя
--   деньги ушли 18 переводами на «Альфа (На продукты)» (347 000 ₽).
--   Ручные перемещения (форма «Добавить операцию») балансы двигали — приложение
--   противоречило само себе.
--
--   Перевод — это две ноги с ОДНИМ externalRef: источник (деньги ушли) и
--   получатель (деньги пришли). amount у обеих ног остаётся положительным
--   (инвариант 018), поэтому направление нельзя вывести из знака суммы —
--   храним его отдельной колонкой. type тоже остаётся 'transfer', иначе
--   разъезжаются фильтр «Перемещение», дашборд «Доход/Расход» и метка.
--
-- Шаги:
--   1. Колонка transferDirection TEXT ('out' | 'in' | NULL для income/expense).
--   2. Backfill по группам externalRef: applyImport вставляет источник первым,
--      поэтому строка с MIN(rowid) в группе — источник ('out'), остальные —
--      получатель ('in'). В группе ровно две ноги.
--   3. Догоняем accounts.balance у НЕфиксированных счетов: раньше их баланс
--      не учитывал переводы, теперь должен. Фиксированные счета (balanceAsOf
--      IS NOT NULL) не трогаем: их снимок уже включает переводы внутри
--      зафиксированного периода, а движения после учитывают формулы
--      currentBalanceOf/CURRENT_BALANCE_EXPR.

ALTER TABLE transactions ADD COLUMN transferDirection TEXT;

UPDATE transactions
   SET transferDirection = CASE
         WHEN rowid = (
           SELECT MIN(t2.rowid)
             FROM transactions t2
            WHERE t2.type = 'transfer'
              AND t2.externalRef = transactions.externalRef
         )
         THEN 'out'
         ELSE 'in'
       END
 WHERE type = 'transfer'
   AND externalRef IS NOT NULL;

UPDATE accounts
   SET balance = balance + COALESCE((
         SELECT SUM(CASE t.transferDirection
                      WHEN 'out' THEN -t.amount
                      WHEN 'in'  THEN  t.amount
                      ELSE 0
                    END)
           FROM transactions t
          WHERE t.accountId = accounts.id
            AND t.type = 'transfer'
       ), 0)
 WHERE balanceAsOf IS NULL;
