import { api, rub } from '../api.js'

export async function render(root) {
  const cats = await api.get('/api/categories')

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
    a.download = `finans-export-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  root.innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="card-label">Версия</div>
        <div class="card-value">0.1.0</div>
        <div class="card-sub">Phase 0 — каркас</div>
      </div>
      <div class="card">
        <div class="card-label">Категорий</div>
        <div class="card-value">${cats.length}</div>
        <div class="card-sub">${cats.filter(c => !c.archived).length} активных</div>
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

    <div class="section-title">Категории</div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Название</th><th>Тип</th><th>Цвет</th></tr></thead>
      <tbody>
        ${cats.map(c => `<tr>
          <td>${c.icon || ''} ${c.name}</td>
          <td>${c.type}</td>
          <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${c.color};vertical-align:middle"></span> ${c.color || ''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>

    <div class="section-title">Подсказка</div>
    <div class="card">
      <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.6">
        Ввод данных — через CLI. Полный список команд: <code>fin agent help</code>.<br>
        Бэкенд должен быть запущен: <code>npm run dev</code> (порт 3737).
      </p>
    </div>
  `

  document.getElementById('export-btn').addEventListener('click', () => {
    exportData().catch(e => alert(e.message))
  })
}
