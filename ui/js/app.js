import { renderSidebar } from './sidebar.js'
import { register, initRouter } from './router.js'
import { render as dashboard } from './views/dashboard.js'
import { render as transactions } from './views/transactions.js'
import { render as accounts } from './views/accounts.js'
import { makeListView } from './views/simple-list.js'

register('/dashboard', dashboard)
register('/transactions', transactions)
register('/accounts', accounts)
register('/deposits', makeListView('deposits'))
register('/portfolio', makeListView('holdings'))
register('/properties', makeListView('properties'))
register('/loans', makeListView('loans'))
register('/subscriptions', makeListView('subscriptions'))
register('/obligations', makeListView('obligations'))

import { render as settings } from './views/settings.js'
register('/settings', settings)

renderSidebar()
initRouter()

window.addEventListener('hashchange', renderSidebar)

// --- Скрытие/показ боковой панели ------------------------------------------
// Состояние хранится в localStorage по ключу `sidebar.hidden`.
// Применяется к .app через класс .sidebar-hidden (см. styles.css).
const SIDEBAR_HIDDEN_KEY = 'sidebar.hidden'

function applySidebarHidden(hidden) {
  const app = document.querySelector('.app')
  if (!app) return
  app.classList.toggle('sidebar-hidden', hidden)
  const btn = document.getElementById('sidebar-toggle')
  if (btn) {
    const icon = btn.querySelector('i')
    if (icon) {
      // Меняем иконку: bars ↔ angle-double-right (визуальный сигнал «развернуть/свернуть»)
      icon.className = hidden ? 'fa fa-angle-double-right' : 'fa fa-bars'
    }
    btn.title = hidden ? 'Показать боковую панель' : 'Скрыть боковую панель'
  }
}

try {
  applySidebarHidden(localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1')
} catch { /* localStorage может быть недоступен */ }

document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const app = document.querySelector('.app')
  if (!app) return
  const next = !app.classList.contains('sidebar-hidden')
  applySidebarHidden(next)
  try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, next ? '1' : '0') } catch {}
})
