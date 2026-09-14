-- holdings: нормализация единиц измерения.
--
-- До миграции:
--   - Тинькофф upsert писал currentValue/currentPrice/avgBuyPrice/totalCost/profit
--     как REAL в РУБЛЯХ (так отдаёт gRPC SDK: Number(units) + nano/1e9).
--   - BCS upsert писал всё это в КОПЕЙКАХ (после Math.round(rubles * 100)).
--   - UI rub() делит на 100 — считает копейки.
--   - /api/summary/net-worth делал SUM(currentValue) — сумма рублей+копеек
--     в одной формуле даёт мусор («34 миллиона»).
--
-- После миграции:
--   - все holdings-деньги в INTEGER КОПЕЙКАХ (REAL-колонка, но хранит integer);
--   - Тинькофф-данные умножены на 100 (рубли → копейки);
--   - BCS не трогаем — уже копейки;
--   - Tinkoff upsert теперь тоже будет умножать на 100.
--
-- Потеря точности: Тинькоффские цены были до 2 знаков (0.3997, 20.56) — после ×100
-- это целое число. BCS-цены до 5 знаков (12.34567) — после ×100 уже 6 знаков, ОК.

UPDATE holdings SET
  currentValue = CAST(ROUND(currentValue * 100) AS INTEGER),
  currentPrice = CAST(ROUND(currentPrice * 100) AS INTEGER),
  avgBuyPrice  = CAST(ROUND(avgBuyPrice  * 100) AS INTEGER),
  totalCost    = CAST(ROUND(totalCost    * 100) AS INTEGER),
  profit       = CAST(ROUND(profit       * 100) AS INTEGER)
WHERE broker = 'tinkoff';

-- blocked (Int) — 0 или 1, не трогаем.
-- quantity (REAL shares) — без конвертации, она вне денег.