import { api, rub, toast } from '../api.js'
import { openModal } from '../ui/modal.js'
import { CATEGORY_ICONS, CATEGORY_EMOJIS, iconHTML } from '../data/categoryIcons.js'
import { BROKER_PROVIDERS as PROVIDERS, providerLabel } from '../data/brokerProviders.js'

export async function render(root) {
  const [cats, creds] = await Promise.all([
    api.get('/api/categories'),
    api.get('/api/broker-credentials').catch(() => [])
  ])
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
    <div class="section-title section-title-row">
      <span>Категории <span class="muted-inline">${active.length} активных${archived.length > 0 ? ` · ${archived.length} в архиве` : ''}</span></span>
      <span class="section-title-actions">
        <button class="btn btn-sm" id="export-btn" title="Скачать все данные в JSON"><i class="fa fa-download"></i> Экспорт JSON</button>
        <button class="btn btn-primary btn-sm" id="add-cat">+ Добавить</button>
      </span>
    </div>
    <div class="table-wrap table-wrap-compact"><table class="table table-compact" id="cats-table">
      <thead><tr><th style="width:32px"></th><th>Название</th><th style="width:90px">Тип</th><th style="width:50px">Цвет</th><th style="width:80px"></th></tr></thead>
      <tbody>
        ${active.length === 0
          ? '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">Нет активных категорий</td></tr>'
          : active.map(c => `
            <tr data-id="${c.id}">
              <td style="color:${c.color}">${iconHTML(c.icon)}</td>
              <td>${escapeHtml(c.name)}</td>
              <td><span class="cat-type cat-type-${c.type}">${c.type === 'expense' ? 'Расход' : 'Доход'}</span></td>
              <td><span class="cat-color-swatch" style="background:${c.color}" title="${escapeHtml(c.color || '')}"></span></td>
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
      <div class="table-wrap table-wrap-compact"><table class="table table-compact">
        <thead><tr><th style="width:32px"></th><th>Название</th><th style="width:90px">Тип</th><th style="width:50px">Цвет</th><th style="width:80px"></th></tr></thead>
        <tbody>
          ${archived.map(c => `
            <tr>
              <td style="color:${c.color}">${iconHTML(c.icon)}</td>
              <td>${escapeHtml(c.name)}</td>
              <td><span class="cat-type cat-type-${c.type}">${c.type === 'expense' ? 'Расход' : 'Доход'}</span></td>
              <td><span class="cat-color-swatch" style="background:${c.color}" title="${escapeHtml(c.color || '')}"></span></td>
              <td><button class="btn btn-sm" data-action="unarchive" data-id="${c.id}" title="Восстановить">↺</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    ` : ''}

    <div class="section-title section-title-row">
      <span>Интеграции с брокерами <span class="muted-inline">${creds.length} записей · токены в БД зашифрованы</span></span>
      <span class="section-title-actions">
        <button class="btn btn-primary btn-sm" id="add-cred">+ Добавить токен</button>
      </span>
    </div>
    ${creds.length === 0 ? `
      <div class="empty-inline">
        <div>Нет интеграций. Добавьте токен Т-Инвестиций (один на все счета, brokerAccountId = <code>all</code>) или БКС (отдельный на каждый счёт).</div>
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">
          Токены хранятся в БД, зашифрованы AES-256-GCM с мастер-ключом <code>data/.encryption.key</code>. Не удаляйте этот файл — иначе токены придётся ввести заново.
        </div>
      </div>
    ` : `
      <div class="table-wrap table-wrap-compact"><table class="table table-compact">
        <thead><tr><th>Провайдер</th><th>brokerAccountId</th><th>Метка</th><th>Токен</th><th>Последний успех</th><th style="width:80px"></th></tr></thead>
        <tbody>
          ${creds.map(c => `
            <tr data-id="${c.id}">
              <td>${escapeHtml(providerLabel(c.provider))}</td>
              <td><code style="font-size:12px">${escapeHtml(c.brokerAccountId)}</code></td>
              <td>${escapeHtml(c.label || '')}</td>
              <td><code style="font-size:12px">${escapeHtml(c.tokenMask)}</code></td>
              <td style="font-size:12px;color:var(--muted)">${c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString('ru-RU') : '—'}${c.lastError ? ` <span style="color:#dc2626" title="${escapeHtml(c.lastError)}">⚠</span>` : ''}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm" data-action="cred-edit" data-id="${c.id}" title="Редактировать">✎</button>
                  <button class="btn btn-sm btn-danger" data-action="cred-delete" data-id="${c.id}" title="Удалить">×</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `}
  `

  document.getElementById('export-btn').addEventListener('click', () => {
    exportData().catch(e => alert(e.message))
  })

  document.getElementById('add-cat').addEventListener('click', () => openCategoryForm(root, null))

  const addCredBtn = document.getElementById('add-cred')
  if (addCredBtn) addCredBtn.addEventListener('click', () => openBrokerCredentialForm(root, null, creds))

  root.querySelectorAll('[data-action="cred-edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = creds.find(x => x.id === btn.dataset.id)
      if (c) openBrokerCredentialForm(root, c, creds)
    })
  })
  root.querySelectorAll('[data-action="cred-delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить токен? Импорт из этого брокера/счёта перестанет работать.')) return
      try {
        await api.del(`/api/broker-credentials/${btn.dataset.id}`)
        toast('Токен удалён', 'success')
        render(root)
      } catch (e) { toast(e.message, 'error') }
    })
  })

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
      // Подсказка «Иконки — FontAwesome 4.7» рядом с label поля «Иконка»,
      // переехала из нижней карточки (задача ui-nastroyki-ubrat-lishnee).
      const iconLabel = dialog.querySelector('[name="icon"]')?.closest('.form-field')?.querySelector('label')
      if (iconLabel) {
        const hint = document.createElement('a')
        hint.href = 'https://fontawesome.com/v4/icons/'
        hint.target = '_blank'
        hint.rel = 'noopener'
        hint.title = 'Открыть каталог FontAwesome 4.7'
        hint.textContent = '?'
        hint.style.cssText = 'display:inline-block;margin-left:6px;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;background:var(--bg);color:var(--muted);font-size:11px;text-decoration:none;font-weight:600'
        iconLabel.appendChild(hint)
      }

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

// --- Broker credentials (API-токены брокеров) -----------------------------

// PROVIDERS и providerLabel импортируются из ../data/brokerProviders.js
// (общий справочник с ui/js/views/simple-list.js).

// Модалка добавления/редактирования токена брокера.
// Безопасность: при сохранении POST/PATCH возвращает запись с открытым `token`,
// мы её НИГДЕ не показываем кроме подтверждения что сохранено (текст «Сохранено»).
function openBrokerCredentialForm(root, existing, allCreds) {
  const isEdit = !!existing
  openModal({
    title: isEdit ? 'Редактировать токен брокера' : 'Новый токен брокера',
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    fields: [
      {
        name: 'provider', label: 'Провайдер', type: 'select', required: true,
        value: existing?.provider || 'tinkoff',
        options: PROVIDERS
      },
      {
        name: 'brokerAccountId', label: 'brokerAccountId', type: 'text', required: true,
        value: existing?.brokerAccountId || '',
        placeholder: 'для Т-Инвестиций: all; для БКС: id счёта (L01xxx)'
      },
      {
        name: 'label', label: 'Метка (необязательно)', type: 'text',
        value: existing?.label || '',
        placeholder: 'ИИС, Основной брокерский…'
      },
      {
        name: 'token', label: isEdit ? 'Новый токен (оставьте пустым, чтобы не менять)' : 'Токен',
        type: 'password', required: !isEdit,
        value: '',
        placeholder: 'вставьте refresh_token из ЛК БКС или токен Т-Инвестиций',
        // autocomplete="new-password" отключает авто-заполнение password-менеджерами
        // (Chrome/Firefox/Safari любят подставлять сохранённый пароль от сайта и
        // обрезать длинные base64-токены до ~64 символов).
        autocomplete: 'new-password',
        spellcheck: 'false'
      }
    ],
    onMount: (dialog) => {
      // Кнопка «Узнать ID счёта БКС» — появляется только для провайдера BCS
      // и только когда в поле «Токен» что-то введено. Решает замкнутый круг:
      // раньше чтобы получить brokerAccountId, нужно было его уже знать.
      const providerSel = dialog.querySelector('[name="provider"]')
      const tokenInput = dialog.querySelector('[name="token"]')
      const brokerAccountIdInput = dialog.querySelector('[name="brokerAccountId"]')
      if (!providerSel || !tokenInput || !brokerAccountIdInput) return

      const discoverBtn = document.createElement('button')
      discoverBtn.type = 'button'
      discoverBtn.className = 'btn btn-sm'
      discoverBtn.textContent = '🔍 Узнать ID счёта БКС'
      discoverBtn.style.cssText = 'margin-top:8px;display:none;align-self:flex-start'

      const updateVisibility = () => {
        discoverBtn.style.display = (providerSel.value === 'bcs' && tokenInput.value.length > 10)
          ? 'inline-flex' : 'none'
      }
      providerSel.addEventListener('change', updateVisibility)
      tokenInput.addEventListener('input', updateVisibility)

      discoverBtn.addEventListener('click', async () => {
        if (!tokenInput.value.trim()) return
        discoverBtn.disabled = true
        const prevText = discoverBtn.textContent
        discoverBtn.textContent = '… Обмениваю токен'
        try {
          const res = await api.post('/api/broker-credentials/discover-bcs-accounts', { token: tokenInput.value.trim() })
          if (!res.accounts || res.accounts.length === 0) {
            toast('БКС не вернул ни одного счёта. Проверьте refresh_token.', 'error')
            return
          }
          // Если счёт один — подставляем сразу; если несколько — показываем в
          // confirm-диалоге. Для 2-3 счетов confirm проще, чем отдельный picker.
          if (res.accounts.length === 1) {
            brokerAccountIdInput.value = res.accounts[0].id
            toast(`ID счёта: ${res.accounts[0].id} — сохранено`, 'success')
          } else {
            const lines = res.accounts.map((a, i) => `${i + 1}. ${a.id}  —  ${a.name || '(без названия)'}`).join('\n')
            const choice = prompt(`БКС вернул ${res.accounts.length} счетов:\n\n${lines}\n\nВведите номер (1..${res.accounts.length}):`, '1')
            const idx = parseInt(choice, 10) - 1
            if (idx >= 0 && idx < res.accounts.length) {
              brokerAccountIdInput.value = res.accounts[idx].id
              toast(`ID счёта: ${res.accounts[idx].id} — сохранено`, 'success')
            } else {
              toast('Отменено', 'error')
            }
          }
        } catch (e) {
          toast('Не удалось получить счета: ' + (e.message || 'ошибка'), 'error')
        } finally {
          discoverBtn.disabled = false
          discoverBtn.textContent = prevText
          updateVisibility()
        }
      })

      // Вставляем кнопку после поля token
      tokenInput.closest('.form-field')?.appendChild(discoverBtn)
      updateVisibility()
    },
    onSubmit: async (data) => {
      try {
        if (isEdit) {
          const patch = { label: data.label, brokerAccountId: data.brokerAccountId }
          if (data.token) patch.token = data.token
          await api.patch(`/api/broker-credentials/${existing.id}`, patch)
          toast('Токен обновлён', 'success')
        } else {
          await api.post('/api/broker-credentials', data)
          toast('Токен сохранён', 'success')
        }
        render(root)
      } catch (e) {
        // Показываем серверное сообщение (валидация, дубль и т. п.)
        throw e
      }
    }
  })
}
