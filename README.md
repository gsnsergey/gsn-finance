# Finans — личный финансовый менеджер

Ввод данных через CLI-агента (текстом или скриншотами в чат). UI в браузере для просмотра и аналитики.

См. [PLAN.md](./PLAN.md) — там целиком архитектура, модели и фазы.

## Структура

```
.
├── PLAN.md           — план и архитектура
├── backend/          — Node + Express + SQLite, REST API
├── cli/              — CLI для агента (`fin agent ...`)
├── ui/               — статический фронтенд (HTML/CSS/JS)
└── data/             — SQLite-файл и бэкапы (в .gitignore)
```

## Быстрый старт

```bash
npm run install:all    # установить зависимости (один раз)
npm run serve:start    # запустить сервер в фоне (сам сделает миграцию и seed)
npm run serve:status   # проверить, что работает
npm run serve:logs     # смотреть лог в реальном времени
npm run serve:stop     # остановить

# Альтернативно:
./bin/ctl start|stop|restart|status|logs
```

UI: http://localhost:3737  
CLI: `npm run cli -- agent <command>` или `node cli/bin/fin.js agent <command>`  
Порт можно переопределить: `FINANS_PORT=3738 npm run serve:start`

## Стек

- Backend: Node.js, Express, better-sqlite3
- DB: SQLite (один файл в `data/finans.db`)
- CLI: Node-скрипт, ходит в REST API
- UI: Vanilla JS + ESM-модули + CSS (без сборки)

## Фазы разработки

См. PLAN.md, раздел 9. Текущая — Phase 0 (каркас).
