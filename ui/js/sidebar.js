const NAV = [
  { section: 'Главное' },
  { path: '/dashboard', label: 'Дашборд', icon: 'tachometer' },
  { path: '/transactions', label: 'Операции', icon: 'exchange' },
  { path: '/reports', label: 'Отчёты', icon: 'pie-chart' },
  { section: 'Активы' },
  { path: '/accounts', label: 'Счета и карты', icon: 'credit-card' },
  { path: '/deposits', label: 'Вклады', icon: 'bank' },
  { path: '/portfolio', label: 'Портфель', icon: 'line-chart' },
  { path: '/properties', label: 'Недвижимость', icon: 'home' },
  { section: 'Обязательства' },
  { path: '/loans', label: 'Кредиты', icon: 'warning' },
  { path: '/subscriptions', label: 'Подписки', icon: 'refresh' },
  { path: '/obligations', label: 'Обязательства', icon: 'handshake-o' },
  { section: 'Прочее' },
  { path: '/import', label: 'Импорт выписки', icon: 'upload' },
  { path: '/import-rules', label: 'Правила маппинга', icon: 'magic' },
  { path: '/settings', label: 'Настройки', icon: 'cog' }
]

export function renderSidebar() {
  const el = document.getElementById('sidebar')
  const path = (window.location.hash || '#/dashboard').slice(1).split('?')[0]
  let html = `<a href="#/dashboard" class="brand"><span class="brand-dot"></span>Finans</a><nav class="nav">`
  for (const item of NAV) {
    if (item.section) {
      html += `<div class="nav-section">${item.section}</div>`
    } else {
      const active = item.path === path ? 'active' : ''
      html += `<a href="#${item.path}" class="${active}"><i class="fa fa-${item.icon} nav-icon"></i>${item.label}</a>`
    }
  }
  html += `</nav>`
  el.innerHTML = html
}
