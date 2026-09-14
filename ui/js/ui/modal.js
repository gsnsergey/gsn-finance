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
  } else {
    const type = f.type || 'text'
    const listAttr = (f.suggestions && f.suggestions.length > 0) ? `list="dl-${id}"` : ''
    const datalist = (f.suggestions && f.suggestions.length > 0)
      ? `<datalist id="dl-${id}">${f.suggestions.map(s => `<option value="${escapeAttr(s)}">`).join('')}</datalist>`
      : ''
    input = `<input type="${type}" name="${f.name}" id="${id}" ${required} ${listAttr} placeholder="${escapeAttr(f.placeholder || '')}" value="${escapeAttr(value)}" ${f.step ? `step="${escapeAttr(f.step)}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} autocomplete="off">${datalist}`
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

export function openModal({ title, fields, submitLabel = 'Сохранить', onSubmit }) {
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

  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })

  const escHandler = e => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler) }
  }
  document.addEventListener('keydown', escHandler)

  form.querySelector('[data-action="cancel"]').addEventListener('click', close)

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

  form.addEventListener('submit', async e => {
    e.preventDefault()
    clearError(form)
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
