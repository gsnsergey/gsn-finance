// Простая модалка на базе нативного <dialog>.
// openModal({ title, fields, submitLabel, onSubmit }) → returns close()

const COLOR_PALETTE = [
  '#1f2937', // slate-800
  '#6b7280', // gray-500
  '#d1d5db', // gray-300
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#eab308', // yellow-500
  '#22c55e', // green-500
  '#10b981', // emerald-500
  '#06b6d4', // cyan-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899'  // pink-500
]

function renderField(f) {
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`
  let input
  const required = f.required ? 'required' : ''
  const value = f.value !== undefined && f.value !== null ? f.value : ''

  if (f.type === 'select') {
    input = `<select name="${f.name}" id="${id}" ${required}>
      ${f.options.map(o => {
        const ov = String(o.value)
        const sel = String(value) === ov ? 'selected' : ''
        return `<option value="${escapeAttr(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`
      }).join('')}
    </select>`
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" id="${id}" ${required} placeholder="${escapeAttr(f.placeholder || '')}">${escapeHtml(value)}</textarea>`
  } else if (f.type === 'toggle') {
    // Сегментированный переключатель (radio-like): 2-3 варианта в одной строке.
    // Скрытое поле [type=hidden] хранит выбранное значение — name такое же,
    // как у обычного input, поэтому onSubmit подхватывает без правок.
    const groupName = f.name
    const opts = f.options || []
    const segs = opts.map((o, i) => {
      const ov = String(o.value)
      const sel = String(value) === ov
      const segId = `${id}-${i}`
      return `<input type="radio" class="toggle-segment" name="${groupName}-seg" id="${segId}" value="${escapeAttr(o.value)}" ${sel ? 'checked' : ''} data-toggle-option>
        <label for="${segId}" class="toggle-label">${escapeHtml(o.label)}</label>`
    }).join('')
    input = `<div class="toggle-group" data-toggle-group>
      ${segs}
      <input type="hidden" name="${f.name}" id="${id}" value="${escapeAttr(value)}" data-toggle-value>
    </div>`
  } else if (f.type === 'checkbox') {
    input = `<input type="checkbox" name="${f.name}" id="${id}" ${value ? 'checked' : ''}>`
  } else if (f.type === 'color') {
    const initColor = normalizeColor(value) || '#333333'
    const palette = f.palette || COLOR_PALETTE
    input = `<div class="color-picker" data-color-picker>
      <input type="hidden" name="${f.name}" id="${id}" value="${escapeAttr(initColor)}" data-color-input>
      <div class="color-palette">
        ${palette.map(c => `<button type="button" class="color-swatch ${c.toLowerCase() === initColor.toLowerCase() ? 'selected' : ''}" data-color="${escapeAttr(c)}" style="background:${escapeAttr(c)}" aria-label="${escapeAttr(c)}"></button>`).join('')}
      </div>
      <div class="color-custom">
        <input type="color" data-color-native value="${escapeAttr(initColor)}" aria-label="Выбрать произвольный цвет">
        <input type="text" data-color-hex placeholder="#000000" value="${escapeAttr(initColor)}" pattern="^#[0-9a-fA-F]{6}$" maxlength="7" class="color-hex">
      </div>
    </div>`
  } else if (f.type === 'category-select') {
    // Кастомный dropdown для категорий: HTML-метки (FA-иконки / эмодзи),
    // потому что нативный <select> рендерит только текст и FA-классы не видны.
    const options = f.options || []
    const matched = options.find(o => String(o.value) === String(value))
    const display = matched ? (matched.html || escapeHtml(matched.label || '')) : escapeHtml(f.placeholder || 'Выберите…')
    const emptyCls = matched ? '' : 'is-empty'
    input = `<div class="category-select" data-category-select>
      <button type="button" class="category-select-trigger ${emptyCls}" data-category-select-trigger aria-haspopup="listbox">
        <span class="category-select-display" data-category-select-display>${display}</span>
        <span class="category-select-caret" aria-hidden="true">▾</span>
      </button>
      <input type="hidden" name="${f.name}" id="${id}" value="${escapeAttr(value)}" data-category-select-value>
      <div class="category-select-dropdown" data-category-select-dropdown role="listbox" hidden>
        <input type="text" class="category-select-search" placeholder="Поиск…" autocomplete="off" data-category-select-search>
        ${options.map(o => {
          const sel = String(o.value) === String(value) ? 'is-selected' : ''
          const html = o.html != null ? o.html : escapeHtml(o.label || '')
          const searchLabel = (o.label != null ? String(o.label) : '').trim()
          return `<div class="category-select-option ${sel}" role="option" data-value="${escapeAttr(o.value)}" data-html="${escapeAttr(o.html != null ? o.html : '')}" data-search-label="${escapeAttr(searchLabel)}">${html}</div>`
        }).join('')}
      </div>
    </div>`
  } else if (f.type === 'combobox') {
    const options = f.options || []
    const matched = options.find(o => o.value === value)
    const initLabel = matched ? matched.label : (value || '')
    input = `<div class="combobox" data-combobox>
      <input type="text" class="combobox-input" id="${id}" placeholder="${escapeAttr(f.placeholder || '')}" value="${escapeAttr(initLabel)}" ${required} autocomplete="off" data-combobox-input>
      <input type="hidden" name="${f.name}" value="${escapeAttr(value)}" data-combobox-value>
      <div class="combobox-dropdown" data-combobox-dropdown hidden>
        ${options.length === 0
          ? '<div class="combobox-empty">Нет вариантов</div>'
          : options.map(o => `<div class="combobox-option" data-value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</div>`).join('')
        }
      </div>
    </div>`
  } else {
    // Для чисел используем text + inputmode="decimal": type="number" в ряде локалей
    // (ru-RU) не принимает запятую как десятичный разделитель, поэтому пользователь
    // не может ввести "1,5". parseNumber ниже сам приведёт запятую к точке.
    const isNumber = f.type === 'number'
    const htmlType = isNumber ? 'text' : (f.type || 'text')
    const inputmodeAttr = isNumber ? 'inputmode="decimal"' : ''
    const listAttr = (f.suggestions && f.suggestions.length > 0) ? `list="dl-${id}"` : ''
    const datalist = (f.suggestions && f.suggestions.length > 0)
      ? `<datalist id="dl-${id}">${f.suggestions.map(s => `<option value="${escapeAttr(s)}">`).join('')}</datalist>`
      : ''
    input = `<input type="${htmlType}" name="${f.name}" id="${id}" ${inputmodeAttr} ${required} ${listAttr} placeholder="${escapeAttr(f.placeholder || '')}" value="${escapeAttr(value)}" ${f.step ? `step="${escapeAttr(f.step)}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} autocomplete="${escapeAttr(f.autocomplete || 'off')}" ${f.spellcheck ? `spellcheck="false"` : ''}>${datalist}`
  }

  return `<div class="form-field ${f.type === 'color' ? 'form-field-color' : ''}">
    <label for="${id}">${escapeHtml(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
    ${input}
  </div>`
}

function normalizeColor(v) {
  if (!v) return null
  const s = String(v).trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    // expand short hex
    return ('#' + s.slice(1).split('').map(c => c + c).join('')).toLowerCase()
  }
  return null
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function escapeAttr(v) { return escapeHtml(v) }

// Парсер числа: поддерживает "1 500", "1,500", "1.5", "1500"
// Возвращает number или null (если пусто/не число).
function parseNumber(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === '') return null
  // убираем пробелы (разделители тысяч), заменяем запятую на точку
  const normalized = s.replace(/\s+/g, '').replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function showError(form, msg) {
  let err = form.querySelector('.form-error')
  if (!err) {
    err = document.createElement('div')
    err.className = 'form-error'
    const actions = form.querySelector('.modal-actions')
    if (actions) actions.before(err)
    else form.appendChild(err)
  }
  err.textContent = msg
}

function clearError(form) {
  const err = form.querySelector('.form-error')
  if (err) err.remove()
}

export function openModal({ title, fields, submitLabel = 'Сохранить', onSubmit, onMount }) {
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')

  let html = `<h2 class="modal-title">${escapeHtml(title)}</h2><form class="modal-form">`
  for (const f of fields) html += renderField(f)
  html += `<div class="modal-actions">
    <button type="button" class="btn" data-action="cancel">Отмена</button>
    <button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button>
  </div></form>`

  dialog.innerHTML = html
  backdrop.appendChild(dialog)
  document.body.appendChild(backdrop)

  const form = dialog.querySelector('form')
  const close = () => backdrop.remove()

  backdrop.addEventListener('click', e => { if (e.target === backdrop) tryClose() })

  const escHandler = e => {
    if (e.key === 'Escape') { tryClose(); document.removeEventListener('keydown', escHandler) }
  }
  document.addEventListener('keydown', escHandler)

  form.querySelector('[data-action="cancel"]').addEventListener('click', () => tryClose())

  // Кастомная разметка после монтирования (например, пикер иконок)
  if (typeof onMount === 'function') {
    try { onMount(dialog) } catch (e) { console.error('onMount error:', e) }
  }

  // Снимок состояния формы сразу после onMount, чтобы корректно отслеживать
  // «грязность»: если пользователь ничего не менял, закрытие должно быть тихим;
  // если менял — спрашиваем перед закрытием по backdrop/Esc/«Отмена».
  const snapshotForm = () => {
    const data = {}
    for (const f of fields) {
      const el = form.querySelector(`[name="${f.name}"]`)
      if (!el) continue
      if (f.type === 'checkbox') data[f.name] = el.checked
      else data[f.name] = el.value
    }
    return JSON.stringify(data)
  }
  const initialSnapshot = snapshotForm()
  const tryClose = () => {
    const cur = snapshotForm()
    if (cur !== initialSnapshot) {
      if (!confirm('В форме есть несохранённые изменения. Закрыть без сохранения?')) return
    }
    close()
  }

  setTimeout(() => {
    const first = form.querySelector('input:not([type=checkbox]), select, textarea')
    if (first) first.focus()
  }, 30)

  // Color pickers — синхронизация между палитрой, native picker и hex-полем
  dialog.querySelectorAll('[data-color-picker]').forEach(picker => {
    const hidden = picker.querySelector('[data-color-input]')
    const native = picker.querySelector('[data-color-native]')
    const hex = picker.querySelector('[data-color-hex]')
    const swatches = picker.querySelectorAll('.color-swatch')

    function setColor(c) {
      const norm = normalizeColor(c)
      if (!norm) return
      hidden.value = norm
      native.value = norm
      hex.value = norm
      swatches.forEach(s => s.classList.toggle('selected', s.dataset.color.toLowerCase() === norm))
    }

    swatches.forEach(s => s.addEventListener('click', () => setColor(s.dataset.color)))
    native.addEventListener('input', () => setColor(native.value))
    hex.addEventListener('input', () => {
      const n = normalizeColor(hex.value)
      if (n) setColor(n)
    })
  })

  // Category-select — кастомный dropdown с HTML-метками (FA-иконки)
  dialog.querySelectorAll('[data-category-select]').forEach(cs => {
    const trigger = cs.querySelector('[data-category-select-trigger]')
    const display = cs.querySelector('[data-category-select-display]')
    const hidden = cs.querySelector('[data-category-select-value]')
    const dropdown = cs.querySelector('[data-category-select-dropdown]')
    const search = cs.querySelector('[data-category-select-search]')
    const options = Array.from(cs.querySelectorAll('.category-select-option'))

    function resetFilter() {
      if (search) search.value = ''
      options.forEach(o => { o.style.display = '' })
    }
    function close() {
      dropdown.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
      resetFilter()
    }
    function open() {
      // закрыть другие открытые category-select в этом диалоге
      dialog.querySelectorAll('[data-category-select-dropdown]:not([hidden])').forEach(d => {
        if (d !== dropdown) d.hidden = true
      })
      // Flip-up, если внизу не помещается ~240px (высота дропдауна)
      const spaceBelow = window.innerHeight - trigger.getBoundingClientRect().bottom
      dropdown.classList.toggle('flip-up', spaceBelow < 240)
      dropdown.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
      resetFilter()
    }

    trigger.addEventListener('click', e => {
      e.stopPropagation()
      if (dropdown.hidden) open(); else close()
    })

    options.forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation()
        hidden.value = opt.dataset.value
        const html = opt.dataset.html || opt.textContent
        display.innerHTML = html
        display.classList.remove('is-empty')
        trigger.classList.remove('is-empty')
        options.forEach(o => o.classList.toggle('is-selected', o === opt))
        close()
      })
    })

    if (search) {
      search.addEventListener('click', e => e.stopPropagation())
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim()
        options.forEach(o => {
          const label = (o.dataset.searchLabel || '').toLowerCase()
          o.style.display = (!q || label.includes(q)) ? '' : 'none'
        })
      })
    }

    // Закрытие по клику вне / Escape
    const onDocClick = e => { if (!cs.contains(e.target)) close() }
    setTimeout(() => document.addEventListener('click', onDocClick), 0)
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    // Чистим слушатели при закрытии модалки
    const observer = new MutationObserver(() => {
      if (!document.body.contains(cs)) {
        document.removeEventListener('click', onDocClick)
        document.removeEventListener('keydown', onKey)
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })

  // Toggle-группы (сегментированный переключатель): клик по радио синхронизирует hidden
  dialog.querySelectorAll('[data-toggle-group]').forEach(group => {
    const hidden = group.querySelector('[data-toggle-value]')
    group.querySelectorAll('[data-toggle-option]').forEach(opt => {
      opt.addEventListener('change', () => {
        if (opt.checked) {
          hidden.value = opt.value
          // дёрнем change на hidden, чтобы внешние слушатели (например, для смены полей формы) среагировали
          hidden.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
    })
  })

  // Comboboxes — поиск по label/value, выбор заполняет hidden
  dialog.querySelectorAll('[data-combobox]').forEach(cb => {
    const input = cb.querySelector('[data-combobox-input]')
    const hidden = cb.querySelector('[data-combobox-value]')
    const dropdown = cb.querySelector('[data-combobox-dropdown]')
    const options = Array.from(cb.querySelectorAll('.combobox-option'))
    let activeIdx = -1

    function showAll() {
      options.forEach(o => o.hidden = false)
      dropdown.hidden = false
      activeIdx = -1
      updateActive()
    }
    function filter(q) {
      const s = q.toLowerCase()
      let visible = 0
      options.forEach(o => {
        const match = o.textContent.toLowerCase().includes(s) || o.dataset.value.toLowerCase().includes(s)
        o.hidden = !match
        if (match) visible++
      })
      dropdown.hidden = visible === 0
      activeIdx = -1
      updateActive()
    }
    function select(opt) {
      input.value = opt.textContent
      hidden.value = opt.dataset.value
      dropdown.hidden = true
    }
    function updateActive() {
      options.forEach((o, i) => o.classList.toggle('active', i === activeIdx))
    }

    // Показываем список только когда пользователь начал вводить — не при фокусе.
    // Фокус (например, при автофокусе первой формы) не открывает дропдаун,
    // это раздражает: открываешь форму — а тебе сразу предлагают выбор.
    input.addEventListener('input', () => { filter(input.value); hidden.value = '' })
    input.addEventListener('blur', () => setTimeout(() => { dropdown.hidden = true }, 200))
    input.addEventListener('keydown', e => {
      const visible = options.filter(o => !o.hidden)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        activeIdx = Math.min(activeIdx + 1, visible.length - 1)
        updateActive()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        activeIdx = Math.max(activeIdx - 1, 0)
        updateActive()
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault()
        select(visible[activeIdx])
      } else if (e.key === 'Escape') {
        dropdown.hidden = true
      }
    })
    options.forEach(opt => {
      opt.addEventListener('mousedown', e => {
        e.preventDefault() // чтобы blur input не сработал раньше
        select(opt)
      })
    })
  })

  form.addEventListener('submit', async e => {
    e.preventDefault()
    clearError(form)
    // Синхронизировать combobox: если пользователь ввёл текст, но не выбрал из списка,
    // отправим введённое значение как есть (свободный ввод)
    dialog.querySelectorAll('[data-combobox]').forEach(cb => {
      const hidden = cb.querySelector('[data-combobox-value]')
      const input = cb.querySelector('[data-combobox-input]')
      if (hidden && input && !hidden.value && input.value) {
        hidden.value = input.value
      }
    })
    const data = {}
    const missing = []
    for (const f of fields) {
      const el = form.querySelector(`[name="${f.name}"]`)
      if (!el) continue
      let v
      if (f.type === 'checkbox') {
        v = el.checked
      } else if (f.type === 'number') {
        v = parseNumber(el.value)
      } else {
        v = el.value
      }
      if (f.required && (v === null || v === '')) {
        missing.push(f.label)
      }
      if (f.type === 'number' && v !== null && f.min !== undefined && v < f.min) {
        showError(form, `Поле «${f.label}» не может быть меньше ${f.min}`)
        return
      }
      if (f.type === 'number' && v !== null && f.max !== undefined && v > f.max) {
        showError(form, `Поле «${f.label}» не может быть больше ${f.max}`)
        return
      }
      data[f.name] = v
    }
    if (missing.length > 0) {
      showError(form, `Заполни обязательные поля: ${missing.join(', ')}`)
      return
    }
    const submitBtn = form.querySelector('[type="submit"]')
    submitBtn.disabled = true
    try {
      await onSubmit(data)
      close()
    } catch (err) {
      showError(form, err.message || String(err))
      submitBtn.disabled = false
    }
  })

  return close
}
