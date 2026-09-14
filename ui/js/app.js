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
register('/loans', makeListView('loans'))
register('/subscriptions', makeListView('subscriptions'))

// /subscriptions — список подписок + обязательств (позже разделим)
import { render as settings } from './views/settings.js'
register('/settings', settings)

renderSidebar()
initRouter()

window.addEventListener('hashchange', renderSidebar)
