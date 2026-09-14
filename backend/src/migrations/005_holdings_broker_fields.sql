-- holdings: разложить avgPrice на «как у брокера»
-- (avgBuyPrice + currentPrice + totalCost + currentValue + profit/profitPct + blocked).
-- avgPrice удаляется.

ALTER TABLE holdings ADD COLUMN avgBuyPrice  REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN currentPrice REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN totalCost    REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN currentValue REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN profit       REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN profitPct    REAL    NOT NULL DEFAULT 0;
ALTER TABLE holdings ADD COLUMN blocked      INTEGER NOT NULL DEFAULT 0;

-- Перенос существующих данных: avgPrice → avgBuyPrice/currentPrice,
-- totalCost/currentValue = quantity * price. profit/Pct = 0
-- (импорт из Т-Инвестиций перепишет реальные currentPrice при следующем pull).
UPDATE holdings SET
  avgBuyPrice  = avgPrice,
  currentPrice = avgPrice,
  totalCost    = quantity * avgPrice,
  currentValue = quantity * avgPrice
WHERE avgBuyPrice = 0 AND avgPrice IS NOT NULL AND avgPrice > 0;

ALTER TABLE holdings DROP COLUMN avgPrice;
