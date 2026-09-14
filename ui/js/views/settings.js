import { api, rub, toast } from '../api.js'
import { openModal } from '../ui/modal.js'
import { CATEGORY_ICONS, CATEGORY_EMOJIS, iconHTML } from '../data/categoryIcons.js'

export async function render(root) {
  const cats = await api.get('/api/categories')
  const active = cats.filter(c => !c.archived)
  const archived = cats.filter(c => c.archived)

  const exportData = async () => {
    const all = {}
    for (const ep of ['accounts', 'transactions', 'categories', 'deposits', 'holdings', 'loans', 'subscriptions', 'obligations']) {
      all[ep] = await api.get(`/api/${ep}`)
    }
    all.exportedAt = new Date().toISOString()
    all.version = '0.1.0'
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  root.innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="card-label">Версия</div>
        <div class="card-value">0.1.0</div>
        <div class="card-sub">Phase 0+ — каркас, формы, справочники</div>
      </div>
      <div class="card">
        <div class="card-label">Категорий</div>
        <div class="card-value">${active.length}</div>
        <div class="card-sub">активных из ${cats.length}</div>
      </div>
    </div>

    <div class="section-title">Данные</div>
    <div class="cards">
      <div class="card">
        <div class="card-label">Экспорт</div>
        <p style="margin: 8px 0 12px; color: var(--muted); font-size: 13px;">
          Все данные в JSON-файле для бэкапа или миграции.
        </p>
        <button class="btn btn-primary" id="export-btn">Скачать JSON</button>
      </div>
    </div>

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>Категории</span>
      <button class="btn btn-primary btn-sm" id="add-cat">+ Добавить</button>
    </div>
    <div class="table-wrap"><table class="table" id="cats-table">
      <thead><tr><th style="width:32px"></th><th>Название</th><th>Тип</th><th>Цвет</th><th style="width:90px"></th></tr></thead>
      <tbody>
        ${active.length === 0
          ? '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">Нет активных категорий</td></tr>'
          : active.map(c => `
            <tr data-id="${c.id}">
              <td style="color:${c.color}">${iconHTML(c.icon)}</td>
              <td>${escapeHtml(c.name)}</td>
              <td>${c.type === 'expense' ? 'Расход' : 'Доход'}</td>
              <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${c.color};vertical-align:middle"></span> ${c.color || ''}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm" data-action="edit" data-id="${c.id}" title="Редактировать">✎</button>
                  <button class="btn btn-sm btn-danger" data-action="archive" data-id="${c.id}" title="Архивировать">⊘</button>
                </div>
              </td>
            </tr>
          `).join('')
        }
      </tbody>
    </table></div>

    ${archived.length > 0 ? `
      <div class="section-title">Архив (${archived.length})</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th style="width:32px"></th><th>Название</th><th>Тип</th><th>Цвет</th><th style="width:90px"></th></tr></thead>
        <tbody>
          ${archived.map(c => `
            <tr>
              <td style="color:${c.color}">${iconHTML(c.icon)}</td>
              <td>${escapeHtml(c.name)}</td>
              <td>${c.type === 'expense' ? 'Расход' : 'Доход'}</td>
              <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${c.color};vertical-align:middle"></span> ${c.color || ''}</td>
              <td><button class="btn btn-sm" data-action="unarchive" data-id="${c.id}" title="Восстановить">↺</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    ` : ''}

    <div class="section-title">Подсказка</div>
    <div class="card">
      <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.6">
        Иконки — из <a href="https://fontawesome.com/v4/icons/" target="_blank">FontAwesome 4.7</a>.
        Стиль иконки в UI зависит от цвета категории.
      </p>
    </div>
  `

  document.getElementById('export-btn').addEventListener('click', () => {
    exportData().catch(e => alert(e.message))
  })

  document.getElementById('add-cat').addEventListener('click', () => openCategoryForm(root, null))

  root.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = active.find(c => c.id === btn.dataset.id)
      if (cat) openCategoryForm(root, cat)
    })
  })

  root.querySelectorAll('[data-action="archive"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Архивировать категорию? Операции с ней сохранятся, но в форме она пропадёт.')) return
      try {
        await api.patch(`/api/categories/${btn.dataset.id}`, { archived: 1 })
        toast('Архивировано', 'success')
        render(root)
      } catch (e) { toast(e.message, 'error') }
    })
  })

  if (archived.length > 0) {
    root.querySelectorAll('[data-action="unarchive"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.patch(`/api/categories/${btn.dataset.id}`, { archived: 0 })
          toast('Восстановлено', 'success')
          render(root)
        } catch (e) { toast(e.message, 'error') }
      })
    })
  }
}

function openCategoryForm(root, category) {
  const isEdit = !!category
  const initColor = category?.color || '#3498db'
  const initIcon = category?.icon || 'tag'

  openModal({
    title: isEdit ? 'Редактировать категорию' : 'Новая категория',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields: [
      { name: 'name', label: 'Название', type: 'text', required: true, placeholder: 'Продукты', value: category?.name },
      {
        name: 'type', label: 'Тип', type: 'select', required: true,
        value: category?.type || 'expense',
        options: [
          { value: 'expense', label: 'Расход' },
          { value: 'income', label: 'Доход' }
        ]
      },
      { name: 'color', label: 'Цвет', type: 'color', value: initColor },
      { name: 'icon', label: 'Иконка', type: 'text', value: initIcon, placeholder: 'shopping-cart' }
    ],
    onSubmit: async (data) => {
      try {
        if (isEdit) {
          await api.patch(`/api/categories/${category.id}`, data)
          toast('Категория обновлена', 'success')
        } else {
          await api.post('/api/categories', data)
          toast('Категория создана', 'success')
        }
        render(root)
      } catch (e) { throw e }
    },
    onMount: (dialog) => {
      // Добавляем пикер иконок сразу после поля "icon"
      const iconField = dialog.querySelector('[name="icon"]')?.closest('.form-field')
      if (!iconField) return

      const picker = document.createElement('div')
      picker.className = 'icon-picker'

      // Определяем, является ли текущая иконка эмодзи (не FA-класс)
      const isAscii = v => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v)
      const initialIsEmoji = !isAscii(initIcon)
      const initialTab = initialIsEmoji ? 'emoji' : 'fa'

      const renderBtns = (items, tab) => items.map(ic => {
        const value = ic.value.startsWith('fa-') ? ic.value.slice(3) : ic.value
        const selected = value === initIcon
        const content = tab === 'fa'
          ? `<i class="fa fa-${value}"></i>`
          : `<span class="icon-picker-emoji">${value}</span>`
        return `<button type="button" class="icon-picker-btn ${selected ? 'selected' : ''}" data-icon="${escapeAttr(value)}" data-tab="${tab}" title="${escapeAttr(ic.label)}">${content}</button>`
      }).join('')

      picker.innerHTML = `
        <div class="icon-picker-tabs" role="tablist">
          <button type="button" class="icon-picker-tab ${initialTab === 'fa' ? 'active' : ''}" data-tab="fa" role="tab">Иконки</button>
          <button type="button" class="icon-picker-tab ${initialTab === 'emoji' ? 'active' : ''}" data-tab="emoji" role="tab">Эмодзи</button>
        </div>
        <div class="icon-picker-panes">
          <div class="icon-picker-pane ${initialTab === 'fa' ? 'active' : ''}" data-pane="fa">
            <div class="icon-picker-grid">${renderBtns(CATEGORY_ICONS, 'fa')}</div>
          </div>
          <div class="icon-picker-pane ${initialTab === 'emoji' ? 'active' : ''}" data-pane="emoji">
            <div class="icon-picker-grid">${renderBtns(CATEGORY_EMOJIS, 'emoji')}</div>
          </div>
        </div>
      `
      iconField.appendChild(picker)

      const iconInput = iconField.querySelector('[name="icon"]')

      picker.querySelectorAll('.icon-picker-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          picker.querySelectorAll('.icon-picker-btn').forEach(b => b.classList.remove('selected'))
          btn.classList.add('selected')
          iconInput.value = btn.dataset.icon
        })
      })

      // Переключение табов
      picker.querySelectorAll('.icon-picker-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.tab
          picker.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.toggle('active', t === tab))
          picker.querySelectorAll('.icon-picker-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === target))
        })
      })
    }
  })
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function escapeAttr(v) { return escapeHtml(v) }
