-- BCS-импорт не заполнял totalCost/profit/profitPct — они оставались нулями,
-- из-за чего у позиций БКС в портфеле не было прибыли и процента.
-- Досчитываем из уже сохранённых quantity / avgBuyPrice / currentValue.
-- Все денежные поля holdings — в копейках, quantity — в штуках.
--
-- profitPct — обычное число (процент), как пишет Тинькофф-upsert.
UPDATE holdings SET
  totalCost = CAST(ROUND(quantity * avgBuyPrice) AS INTEGER),
  profit    = CAST(ROUND(currentValue - quantity * avgBuyPrice) AS INTEGER),
  profitPct = CASE
    WHEN quantity * avgBuyPrice > 0
      THEN (currentValue - quantity * avgBuyPrice) * 100.0 / (quantity * avgBuyPrice)
    ELSE 0
  END
WHERE broker = 'bcs' AND totalCost = 0;
