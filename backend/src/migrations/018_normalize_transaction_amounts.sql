-- Нормализация знака amount у транзакций.
--
-- Инвариант всего кода: transactions.amount >= 0, а знак операции берётся из
-- transactions.type (balance.js:signedDelta, CURRENT_BALANCE_EXPR, POST/PATCH
-- транзакций, рендер списка операций). Исторический импорт выписок писал
-- expense со знаком минус (import.js: signedSource), нарушая этот инвариант.
--
-- Все отрицательные amount в существующей БД — это импортированные расходы
-- (type=expense, source=import); остальные типы уже хранятся положительными.
--
-- Важно про влияние на формулы: до миграции amount=-A, и CURRENT_BALANCE_EXPR
-- (expense → -amount) давала +A — то есть вклад расхода в «движение после
-- balanceAsOf» был инвертирован. После нормализации -(+A) = -A, знак вклада
-- становится верным. На счета без фиксации это не влияет (currentBalance там
-- равен accounts.balance, который миграция не трогает); для сверенных счетов
-- это исправляет будущие расчёты движения. На момент применения строк с датой
-- позже balanceAsOf не было, поэтому существующие currentBalance не изменились.
UPDATE transactions SET amount = ABS(amount)
 WHERE amount < 0 AND type = 'expense';
