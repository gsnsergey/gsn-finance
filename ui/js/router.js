// Простой hash-роутер: #/dashboard, #/transactions, ...

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
    '/loans': 'Кредиты',
    '/subscriptions': 'Подписки и обязательства',
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
  window.addEventListener('hashchange', render)
  if (!window.location.hash) window.location.hash = '#/dashboard'
  render()
}
