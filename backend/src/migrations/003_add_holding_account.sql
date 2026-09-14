-- Субсчёт / пакет брокера (например: «Основной», «ИИС», «Премиум»).
-- NULL означает «без субсчёта».
ALTER TABLE holdings ADD COLUMN account TEXT;
