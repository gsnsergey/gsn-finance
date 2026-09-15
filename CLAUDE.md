# CLAUDE.md

Полные правила: **AGENTS.md**
Дизайн-система (токены, компоненты, HTML-примеры): **DESIGN.md**
Рецепты (CRUD, формы, фильтры, тёмная тема): **SKILLS.md**
Как пользоваться всеми файлами: **README-AI.md**

## Стек в 5 строк
Vanilla ES-модули, точка входа `ui/js/app.js`, hash-роутер `ui/js/router.js`,
вьюхи в `ui/js/views/*.js` экспортируют `render(root)`. Один CSS — `ui/css/styles.css`.
Иконки — Font Awesome 4 из `ui/vendor/font-awesome/`. Сборки и npm нет.

## Топ-5 запретов
1. ❌ React/Vue/Svelte/Alpine/jQuery/Tailwind/Bootstrap/Material и любые UI-киты.
2. ❌ Новые CSS-файлы и npm-пакеты.
3. ❌ `innerHTML` с пользовательскими значениями без `escapeHtml()`.
4. ❌ Inline-стили с хардкод-цветами (только через `var(--…)`).
5. ❌ Правки `ui/js/ui/modal.js` без явного запроса (центральный компонент).

Все остальные правила — в **AGENTS.md** (раздел «Строгие запреты» и «Чеклист»).