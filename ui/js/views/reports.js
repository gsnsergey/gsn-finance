import { api, rub, escapeHtml, cssColor, toast } from '../api.js'
import { categoryIconHTML } from '../data/categoryIcons.js'

// Отчёты: доходы/расходы с фильтрами и диаграммами.
//
// Диаграммы — чистый inline-SVG, построенный в JS: сторонних библиотек
// в проекте нет и не будет (AGENTS.md §3). Два вида:
//   • динамика по месяцам — группированные столбцы доход/расход;
//   • структура — donut (кольцо на <circle> + stroke-dasharray/dashoffset).
//
// Переводы между своими счетами в отчёт не попадают вообще — их исключает
// бэкенд (routes/reports.js), поэтому фильтра «Перемещение» здесь нет.

// Фолбэк-палитра для donut/легенды, когда у категории нет валидного цвета.
// Только токены; подстановка — через cssColor(), единственный разрешённый
// способ протащить цвет из данных (AGENTS.md §4, DESIGN.md §4.12).
const CHART_PALETTE = [
  'var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)',
  'var(--pink)', 'var(--cyan)', 'var(--yellow)', 'var(--red)',
  'var(--indigo)', 'var(--lime)', 'var(--azure)'
]

// Короткая сумма для осей и центра donut: рубли без копеек, без HTML
// (в SVG-тексте разметка недопустима).
function shortMoney(kop) {
  const n = Math.round(Number(kop || 0) / 100)
  return n.toLocaleString('ru-RU')
}

// '2026-08' → '08.2026' (формат подписей оси X).
function fmtPeriod(period) {
  const m = String(period).match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[2]}.${m[1]}` : String(period)
}

// Красивый максимум оси: округляем вверх до 1/2/5×10^n, чтобы верхняя
// подпись была круглой, а столбцы не упирались в потолок графика.
function niceMax(value) {
  if (!(value > 0)) return 0
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  const n = value / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

function chartEmpty() {
  return '<div class="chart-empty">Нет данных за выбранный период</div>'
}

// Группированная столбчатая диаграмма доход/расход по месяцам.
// viewBox совпадает с пиксельными размерами (1:1) — поэтому кегли подписей
// можно задавать в px обычными CSS-классами.
function barChartSvg(periods) {
  const maxVal = periods.reduce((m, p) => Math.max(m, p.income, p.expense), 0)
  if (maxVal <= 0) return null

  const top = niceMax(maxVal)
  const padTop = 16, padBottom = 28, padLeft = 60, padRight = 16
  const plotH = 196
  const height = padTop + plotH + padBottom
  const groupW = 48, barW = 13, innerGap = 3
  const width = padLeft + periods.length * groupW + padRight
  const yOf = v => padTop + plotH - (v / top) * plotH
  const fmt = v => Number(v).toFixed(1)

  let grid = ''
  let labels = ''
  let bars = ''
  for (let k = 0; k <= 4; k++) {
    const val = (top * k) / 4
    const y = yOf(val)
    grid += `<line class="chart-grid-line" x1="${padLeft}" y1="${fmt(y)}" x2="${width - padRight}" y2="${fmt(y)}"></line>`
    labels += `<text class="chart-axis-label" x="${padLeft - 8}" y="${fmt(y + 3)}" text-anchor="end">${shortMoney(val)}</text>`
  }
  periods.forEach((p, i) => {
    const gx = padLeft + i * groupW + (groupW - (barW * 2 + innerGap)) / 2
    const hIncome = (p.income / top) * plotH
    const hExpense = (p.expense / top) * plotH
    if (hIncome > 0) {
      bars += `<rect class="chart-bar-income" x="${fmt(gx)}" y="${fmt(padTop + plotH - hIncome)}" width="${barW}" height="${fmt(hIncome)}" rx="2"></rect>`
    }
    if (hExpense > 0) {
      bars += `<rect class="chart-bar-expense" x="${fmt(gx + barW + innerGap)}" y="${fmt(padTop + plotH - hExpense)}" width="${barW}" height="${fmt(hExpense)}" rx="2"></rect>`
    }
    labels += `<text class="chart-axis-label" x="${fmt(gx + barW + innerGap / 2)}" y="${height - 9}" text-anchor="middle">${fmtPeriod(p.period)}</text>`
  })

  const desc = periods
    .map(p => `${fmtPeriod(p.period)}: доход ${shortMoney(p.income)} ₽, расход ${shortMoney(p.expense)} ₽`)
    .join('; ')
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml('Динамика по месяцам. ' + desc)}">${grid}${bars}${labels}</svg>`
}

// Donut на <circle>: окружность при r≈15.915 составляет ровно 100 единиц,
// поэтому доли в процентах кладутся в stroke-dasharray напрямую, а сдвиг
// 25 − накопленная доля разворачивает начало сегмента на 12 часов.
function donutSvg(rows, total, type) {
  if (!(total > 0)) return null
  let cumulative = 0
  let segments = ''
  rows.forEach((row, i) => {
    const fraction = row.amount / total
    const color = cssColor(row.color, CHART_PALETTE[i % CHART_PALETTE.length])
    const dash = (fraction * 100).toFixed(3)
    const rest = (100 - fraction * 100).toFixed(3)
    const offset = (25 - cumulative * 100).toFixed(3)
    segments += `<circle cx="21" cy="21" r="15.915" fill="none" style="stroke:${color}" stroke-width="6" stroke-dasharray="${dash} ${rest}" stroke-dashoffset="${offset}"></circle>`
    cumulative += fraction
  })
  const label = type === 'income' ? 'Доходы' : 'Расходы'
  const desc = rows.map(r => `${r.name}: ${shortMoney(r.amount)} ₽`).join('; ')
  return `<svg class="chart-svg chart-donut" width="200" height="200" viewBox="0 0 42 42" role="img" aria-label="${escapeHtml(label + ' по категориям. ' + desc)}">
    <circle class="chart-donut-track" cx="21" cy="21" r="15.915" fill="none" stroke-width="6"></circle>
    ${segments}
    <text class="chart-donut-value" x="21" y="20.4" text-anchor="middle">${escapeHtml(shortMoney(total))}</text>
    <text class="chart-donut-caption" x="21" y="25" text-anchor="middle">${label === 'Доходы' ? 'доходы' : 'расходы'}</text>
  </svg>`
}

function legendHtml(rows, total) {
  return `<ul class="chart-legend">${rows.map((row, i) => {
    const color = cssColor(row.color, CHART_PALETTE[i % CHART_PALETTE.length])
    const pct = total > 0 ? (row.amount / total) * 100 : 0
    return `<li class="chart-legend-item">
      <span class="chart-legend-marker" style="background:${color}"></span>
      <span class="chart-legend-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
      <span class="chart-legend-value">${rub(row.amount)}</span>
      <span class="chart-legend-share">${pct.toFixed(1)}%</span>
    </li>`
  }).join('')}</ul>`
}

function categoriesTableHtml(rows) {
  if (rows.length === 0) {
    return `<div class="section-title">Структура по категориям</div>
      <div class="table-wrap"><div class="empty"><div class="empty-title">Нет данных</div>За выбранный период операций по категориям нет.</div></div>`
  }
  // Доля считается внутри своего типа: смешивать доход и расход в одном
  // знаменателе некорректно.
  const totalsByType = {}
  for (const r of rows) totalsByType[r.type] = (totalsByType[r.type] || 0) + r.amount

  return `<div class="section-title">Структура по категориям</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Категория</th><th>Тип</th><th class="num">Сумма</th><th>Доля</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const total = totalsByType[r.type] || 0
            const pct = total > 0 ? (r.amount / total) * 100 : 0
            const isIncome = r.type === 'income'
            return `<tr>
              <td>${categoryIconHTML(r.icon)} ${escapeHtml(r.name)}</td>
              <td><span class="badge badge-${isIncome ? 'income' : 'expense'}">${isIncome ? 'Доход' : 'Расход'}</span></td>
              <td class="num">${rub(r.amount)}</td>
              <td>
                <div class="share-bar">
                  <div class="share-bar-track"><div class="share-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
                  <span class="share-bar-pct">${pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`
}

function accountsTableHtml(rows) {
  if (rows.length === 0) {
    return `<div class="section-title">По счетам</div>
      <div class="table-wrap"><div class="empty"><div class="empty-title">Нет данных</div>За выбранный период операций по счетам нет.</div></div>`
  }
  return `<div class="section-title">По счетам</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Счёт</th><th class="num">Доход</th><th class="num">Расход</th><th class="num">Итого</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const net = r.income - r.expense
            return `<tr>
              <td>${escapeHtml(r.name)}</td>
              <td class="num num-income">${rub(r.income)}</td>
              <td class="num num-expense">${rub(r.expense)}</td>
              <td class="num">${rub(net)}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`
}

export async function render(root) {
  const [accounts, categories] = await Promise.all([
    api.get('/api/accounts'),
    api.get('/api/categories')
  ])

  // Состояние фильтров в замыкании. Изменение любого поля → перезапрос и
  // перерисовка только результатов (тулбар не трогаем — фильтры не сбрасываются).
  const filters = { from: '', to: '', accountId: '', categoryId: '', type: '' }
  // Тип структуры (donut) — не фильтр, а режим просмотра. Показывается
  // переключателем только когда фильтр «Вид операции» = «Все».
  let donutMode = 'expense'

  // Глубокие ссылки: #/reports?from=…&to=…&type=…&accountId=…&categoryId=…
  // (образец — transactions.js). Невалидный type игнорируем, чтобы не получить
  // 400 из-за опечатки в hash.
  const hash = window.location.hash || ''
  const qIdx = hash.indexOf('?')
  if (qIdx >= 0) {
    try {
      const params = new URLSearchParams(hash.slice(qIdx + 1))
      for (const k of Object.keys(filters)) {
        const v = params.get(k)
        if (!v) continue
        if (k === 'type' && v !== 'income' && v !== 'expense') continue
        filters[k] = v
      }
      if (filters.type) donutMode = filters.type
    } catch { /* malformed query — игнорируем */ }
  }

  function buildQuery() {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v)
    }
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

  function resultsHtml(data) {
    const t = data.totals
    const donutType = filters.type || donutMode
    const donutRows = data.categories.filter(c => c.type === donutType && c.amount > 0)
    const donutTotal = donutRows.reduce((s, c) => s + c.amount, 0)
    const showToggle = !filters.type
    const bar = barChartSvg(data.periods)
    const donut = donutSvg(donutRows, donutTotal, donutType)

    return `
      <div class="cards cards--4">
        <div class="card success">
          <div class="card-label">Доходы</div>
          <div class="card-value">${rub(t.income)}</div>
          <div class="card-sub">за выбранный период</div>
        </div>
        <div class="card danger">
          <div class="card-label">Расходы</div>
          <div class="card-value">${rub(t.expense)}</div>
          <div class="card-sub">за выбранный период</div>
        </div>
        <div class="card ${t.net >= 0 ? 'success' : 'danger'}">
          <div class="card-label">Сальдо</div>
          <div class="card-value">${rub(t.net)}</div>
          <div class="card-sub">доходы − расходы</div>
        </div>
        <div class="card">
          <div class="card-label">Операций</div>
          <div class="card-value">${t.count}</div>
          <div class="card-sub">без переводов</div>
        </div>
      </div>

      <div class="report-charts">
        <div class="chart-block">
          <div class="chart-head"><div class="chart-title">Динамика по месяцам</div></div>
          <div class="chart-wrap">${bar || chartEmpty()}</div>
          ${bar ? `<ul class="chart-legend chart-legend--inline">
            <li class="chart-legend-item"><span class="chart-legend-marker" style="background:var(--success)"></span><span class="chart-legend-name">Доходы</span></li>
            <li class="chart-legend-item"><span class="chart-legend-marker" style="background:var(--danger)"></span><span class="chart-legend-name">Расходы</span></li>
          </ul>` : ''}
        </div>
        <div class="chart-block">
          <div class="chart-head">
            <div class="chart-title">Структура</div>
            ${showToggle ? `<div class="view-mode-toggle">
              <button class="view-mode-btn${donutType === 'expense' ? ' active' : ''}" data-action="chart-type" data-type="expense">Расходы</button>
              <button class="view-mode-btn${donutType === 'income' ? ' active' : ''}" data-action="chart-type" data-type="income">Доходы</button>
            </div>` : ''}
          </div>
          ${donut
            ? `<div class="chart-donut-body"><div class="chart-wrap">${donut}</div>${legendHtml(donutRows, donutTotal)}</div>`
            : chartEmpty()}
        </div>
      </div>

      ${categoriesTableHtml(data.categories)}
      ${accountsTableHtml(data.accounts)}
    `
  }

  function renderResults(data) {
    // Контейнер ищем каждый раз: до записи root.innerHTML его ещё нет.
    const results = root.querySelector('[data-reports-results]')
    results.innerHTML = resultsHtml(data)
    // Обработчики — после записи DOM.
    results.querySelectorAll('[data-action="chart-type"]').forEach(btn => {
      btn.addEventListener('click', () => {
        donutMode = btn.dataset.type
        renderResults(data)
      })
    })
  }

  // Монотонный токен: при быстрой смене фильтров запросы идут параллельно, и без
  // него последним отрисуется тот, что ответил последним, а не отправлен последним,
  // — новые фильтры показали бы старые данные. Устаревший ответ отбрасываем.
  let reqSeq = 0
  async function loadAndRender() {
    const my = ++reqSeq
    try {
      const data = await api.get(`/api/reports/income-expense${buildQuery()}`)
      if (my !== reqSeq) return
      renderResults(data)
    } catch (e) {
      if (my !== reqSeq) return
      toast('Не удалось загрузить отчёт: ' + e.message, 'error')
    }
  }

  function syncResetVisibility() {
    const reset = root.querySelector('[data-action="reset"]')
    if (reset) reset.hidden = !Object.values(filters).some(v => v)
  }

  root.innerHTML = `
    <div class="page-toolbar page-toolbar--filters">
      <div class="filters-bar filters-bar--inline">
        <label class="filter"><span>Дата от</span><input type="date" data-filter="from" value="${escapeHtml(filters.from)}"></label>
        <label class="filter"><span>Дата до</span><input type="date" data-filter="to" value="${escapeHtml(filters.to)}"></label>
        <label class="filter"><span>Счёт</span>
          <select data-filter="accountId">
            <option value="">Все</option>
            ${accounts.map(a => `<option value="${escapeHtml(a.id)}"${filters.accountId === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter"><span>Категория</span>
          <select data-filter="categoryId">
            <option value="">Все</option>
            ${categories.map(c => `<option value="${escapeHtml(c.id)}"${filters.categoryId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter"><span>Вид операции</span>
          <select data-filter="type">
            <option value="">Все</option>
            <option value="income"${filters.type === 'income' ? ' selected' : ''}>Доход</option>
            <option value="expense"${filters.type === 'expense' ? ' selected' : ''}>Расход</option>
          </select>
        </label>
        <button class="btn btn-sm" data-action="reset"${Object.values(filters).some(v => v) ? '' : ' hidden'}>Сбросить</button>
      </div>
    </div>
    <div class="reports-page" data-reports-results></div>
  `

  root.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      filters[el.dataset.filter] = el.value
      syncResetVisibility()
      loadAndRender()
    })
  })

  const resetBtn = root.querySelector('[data-action="reset"]')
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      for (const k of Object.keys(filters)) filters[k] = ''
      root.querySelectorAll('[data-filter]').forEach(el => { el.value = '' })
      donutMode = 'expense'
      syncResetVisibility()
      loadAndRender()
    })
  }

  await loadAndRender()
}
