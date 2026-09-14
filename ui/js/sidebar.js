const NAV = [
  { section: 'Главное' },
  { path: '/dashboard', label: 'Дашборд', icon: '◉' },
  { path: '/transactions', label: 'Операции', icon: '↔' },
  { section: 'Активы' },
  { path: '/accounts', label: 'Счета и карты', icon: '▢' },
  { path: '/deposits', label: 'Вклады', icon: '⌘' },
  { path: '/portfolio', label: 'Портфель', icon: '◈' },
  { section: 'Обязательства' },
  { path: '/loans', label: 'Кредиты', icon: '⚠' },
  { path: '/subscriptions', label: 'Подписки', icon: '↻' },
  { section: 'Прочее' },
  { path: '/settings', label: 'Настройки', icon: '⚙' }
]

export function renderSidebar() {
  const el = document.getElementById('sidebar')
  const path = (window.location.hash || '#/dashboard').slice(1)
  let html = `<a href="#/dashboard" class="brand"><span class="brand-dot"></span>Finans</a><nav class="nav">`
  for (const item of NAV) {
    if (item.section) {
      html += `<div class="nav-section">${item.section}</div>`
    } else {
      const active = item.path === path ? 'active' : ''
      html += `<a href="#${item.path}" class="${active}"><span class="nav-icon">${item.icon}</span>${item.label}</a>`
    }
  }
  html += `</nav>`
  el.innerHTML = html
}
