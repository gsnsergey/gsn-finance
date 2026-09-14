-- Фиксация остатка счёта.
--
-- balance      — зафиксированный остаток (копейки) на момент balanceAsOf;
-- balanceAsOf  — дата фиксации, ISO YYYY-MM-DD.
--
-- balanceAsOf IS NULL = фиксации нет: balance считается текущим остатком
-- (прежнее инкрементальное поведение), ретро-проверка не применяется.
-- Существующие счета мигрируют без изменений баланса: balanceAsOf = NULL.
ALTER TABLE accounts ADD COLUMN balanceAsOf TEXT;
