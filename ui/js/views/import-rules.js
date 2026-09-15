// CRUD для правил маппинга (import_rules).
//
// Правила определяют, в какую категорию попадают операции, импортированные
// из банковских выписок. Приоритет: меньше число — раньше применяется.
// Счёт-специфичные правила (accountId = конкретный счёт) перебивают
// глобальные (accountId IS NULL) при равном priority.
//
// matchType:
//   mcc             — 4-значный MCC-код (5411 продукты, 5812 рестораны, …)
//   merchantName    — точное имя продавца (DOSTAVKA IZ PYATEROCH, …)
//   merchantId      — terminalId операции (крайне редко; для исключений)
//   descriptionRegex — RegExp по полной строке операции (для нетривиальных случаев)

import { api, toast, escapeHtml } from '../api.js'


const MATCH_LABELS = {
  mcc: 'MCC',
  merchantName: 'Merchant',
  merchantId: 'Terminal ID',
  descriptionRegex: 'Regex'
}

const MATCH_HINTS = {
  mcc: '4 цифры (5411 = продукты, 5812 = рестораны, 5814 = фастфуд, 5541 = АЗС, …)',
  merchantName: 'Точное имя продавца как в выписке (например, DOSTAVKA IZ PYATEROCH)',
  merchantId: 'Terminal ID (для нестандартных правил по конкретному терминалу)',
  descriptionRegex: 'Регулярное выражение по полной строке операции (якоря ^ и $ поддерживаются)'
}

export async function render(root) {
  const [rules, accounts, categories] = await Promise.all([
    api.get('/api/import-rules'),
    api.get('/api/accounts'),
    api.get('/api/categories')
  ])

  const accountName = id => accounts.find(a => a.id === id)?.name || 'все счета (глобальное)'
  const categoryName = id => categories.find(c => c.id === id)?.name || '—'

  function renderShell() {
    root.innerHTML = `
      <div class="page-toolbar">
        <h2 class="page-title">Правила маппинга</h2>
      </div>
      <div class="rules-intro">
        Правила определяют, в какую категорию попадают операции, импортированные
        из банковских выписок. Сначала применяются правила с меньшим
        <code>priority</code>. Счёт-специфичные правила перебивают глобальные.
        <a href="#/import">К импорту →</a>
      </div>

      <div class="rule-form">
        <h3>Новое правило</h3>
        <div class="form-grid">
          <label class="form-field"><span>Тип совпадения</span>
            <select id="rule-type">
              <option value="mcc">MCC</option>
              <option value="merchantName">Merchant</option>
              <option value="merchantId">Terminal ID</option>
              <option value="descriptionRegex">Regex по описанию</option>
            </select>
          </label>
          <label class="form-field"><span>Значение</span>
            <input type="text" id="rule-value" placeholder="5411">
            <small id="rule-hint" class="hint-warn"></small>
          </label>
          <label class="form-field"><span>Категория</span>
            <select id="rule-category">
              <option value="">— выбрать —</option>
              ${categories.filter(c => !c.archived).map(c =>
                `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
              ).join('')}
            </select>
          </label>
          <label class="form-field"><span>Счёт</span>
            <select id="rule-account">
              <option value="">Все счета (глобальное)</option>
              ${accounts.filter(a => !a.archived).map(a =>
                `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`
              ).join('')}
            </select>
          </label>
          <label class="form-field"><span>Priority</span>
            <input type="number" id="rule-priority" value="100" min="1" max="999">
            <small class="hint-warn">Меньше = выше приоритет</small>
          </label>
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-primary" id="rule-add">+ Добавить правило</button>
          <span id="rule-form-msg" class="import-filename"></span>
        </div>
      </div>

      <h3 style="margin-top:24px">Существующие правила (${rules.length})</h3>
      <div id="rules-table"></div>
    `

    // Подсказка для значения меняется по типу.
    const typeEl = document.getElementById('rule-type')
    const hintEl = document.getElementById('rule-hint')
    const valueEl = document.getElementById('rule-value')
    const syncHint = () => {
      const t = typeEl.value
      hintEl.textContent = MATCH_HINTS[t] || ''
      valueEl.placeholder = t === 'mcc' ? '5411' : t === 'descriptionRegex' ? 'PYATEROCH|MAGNIT' : t === 'merchantName' ? 'DOSTAVKA IZ PYATEROCH' : '32410885'
    }
    typeEl.addEventListener('change', syncHint)
    syncHint()

    document.getElementById('rule-add').addEventListener('click', addRule)
    renderRules()
  }

  async function addRule() {
    const body = {
      matchType: document.getElementById('rule-type').value,
      matchValue: document.getElementById('rule-value').value.trim(),
      categoryId: document.getElementById('rule-category').value,
      accountId: document.getElementById('rule-account').value || null,
      priority: Number(document.getElementById('rule-priority').value) || 100
    }
    if (!body.matchValue || !body.categoryId) {
      toast('Заполните значение и категорию', 'error')
      return
    }
    try {
      await api.post('/api/import-rules', body)
      toast('Правило добавлено', 'success')
      // Очищаем форму и перезагружаем список.
      document.getElementById('rule-value').value = ''
      document.getElementById('rule-category').value = ''
      // После создания — refresh страницы, чтобы гарантированно показать новое правило.
      const r = await api.get('/api/import-rules')
      rules.length = 0
      rules.push(...r)
      renderRules()
    } catch (e) {
      toast('Не удалось добавить правило: ' + e.message, 'error')
    }
  }

  async function deleteRule(id) {
    if (!confirm('Удалить правило?')) return
    try {
      await api.del(`/api/import-rules/${id}`)
      const idx = rules.findIndex(r => r.id === id)
      if (idx >= 0) rules.splice(idx, 1)
      renderRules()
      toast('Удалено', 'success')
    } catch (e) {
      toast('Не удалось удалить: ' + e.message, 'error')
    }
  }

  function renderRules() {
    const el = document.getElementById('rules-table')
    if (rules.length === 0) {
      el.innerHTML = `<div class="empty"><div class="empty-title">Правил пока нет</div>Добавьте первое правило выше — обычно достаточно MCC → категория для основных кодов (5411/5812/5814/5541/5441/4121).</div>`
      return
    }
    el.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Значение</th>
              <th>→ Категория</th>
              <th>Счёт</th>
              <th style="width:70px">Priority</th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody>
            ${rules.map(r => `
              <tr>
                <td><span class="badge badge-info">${escapeHtml(MATCH_LABELS[r.matchType] || r.matchType)}</span></td>
                <td><code>${escapeHtml(r.matchValue)}</code></td>
                <td>${escapeHtml(categoryName(r.categoryId))}</td>
                <td>${escapeHtml(accountName(r.accountId))}</td>
                <td>${r.priority}</td>
                <td><button class="btn btn-sm btn-danger" data-del="${escapeHtml(r.id)}" title="Удалить">×</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    el.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => deleteRule(b.dataset.del))
    })
  }

  renderShell()
}