// Простой hash-роутер: #/dashboard, #/transactions, ...

import { render as renderImport } from './views/import.js'
import { render as renderImportRules } from './views/import-rules.js'

const routes = new Map()

export function register(path, view) {
  routes.set(path, view)
}

export function currentPath() {
  const hash = window.location.hash || '#/dashboard'
  return hash.slice(1) // убираем #
}

export async function navigate(path) {
  if (window.location.hash !== `#${path}`) {
    window.location.hash = `#${path}`
    return // hashchange сам вызовет render
  }
  await render()
}

async function render() {
  const path = currentPath()
  const view = routes.get(path) || routes.get('/dashboard')
  const root = document.getElementById('view')
  root.innerHTML = '<div class="loading">Загрузка...</div>'

  // sidebar active state
  document.querySelectorAll('.nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === `#${path}`)
  })

  // topbar title
  const titleEl = document.getElementById('page-title')
  const titleMap = {
    '/dashboard': 'Дашборд',
    '/transactions': 'Операции',
    '/accounts': 'Счета и карты',
    '/deposits': 'Вклады',
    '/portfolio': 'Портфель',
    '/properties': 'Недвижимость',
    '/loans': 'Кредиты',
    '/subscriptions': 'Подписки',
    '/obligations': 'Обязательства',
    '/import': 'Импорт выписки',
    '/import-rules': 'Правила маппинга',
    '/settings': 'Настройки'
  }
  titleEl.textContent = titleMap[path] || 'Finans'

  try {
    await view(root)
  } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-title">Ошибка</div>${e.message}</div>`
  }
}

export function initRouter() {
  // Регистрация view-модулей. Делается здесь (а не наверху модуля), чтобы
  // все зависимости (api.js, ui/modal.js) успели инициализироваться.
  register('/import', renderImport)
  register('/import-rules', renderImportRules)

  window.addEventListener('hashchange', render)
  if (!window.location.hash) window.location.hash = '#/dashboard'
  render()
}
