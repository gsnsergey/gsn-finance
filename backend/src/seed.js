import db from './db.js'
import { v4 as uuid } from 'uuid'

const now = () => new Date().toISOString()

const count = db.prepare('SELECT COUNT(*) as c FROM categories').get().c
if (count === 0) {
  const expenses = [
    { name: 'Продукты', color: '#e74c3c', icon: 'shopping-cart' },
    { name: 'Транспорт', color: '#3498db', icon: 'car' },
    { name: 'Жильё', color: '#9b59b6', icon: 'home' },
    { name: 'Коммуналка', color: '#1abc9c', icon: 'bolt' },
    { name: 'Связь', color: '#34495e', icon: 'mobile' },
    { name: 'Здоровье', color: '#e67e22', icon: 'medkit' },
    { name: 'Кафе', color: '#f39c12', icon: 'coffee' },
    { name: 'Одежда', color: '#e91e63', icon: 'tshirt' },
    { name: 'Развлечения', color: '#9c27b0', icon: 'film' },
    { name: 'Подписки', color: '#673ab7', icon: 'tv' },
    { name: 'Образование', color: '#3f51b5', icon: 'graduation-cap' },
    { name: 'Прочее', color: '#95a5a6', icon: 'tag' }
  ]
  const incomes = [
    { name: 'Зарплата', color: '#27ae60', icon: 'briefcase' },
    { name: 'Подработка', color: '#16a085', icon: 'money' },
    { name: 'Перевод', color: '#2ecc71', icon: 'exchange' },
    { name: 'Прочее', color: '#95a5a6', icon: 'plus-circle' }
  ]

  const ins = db.prepare(`INSERT INTO categories (id, name, type, color, icon, archived) VALUES (?, ?, ?, ?, ?, 0)`)
  const tx = db.transaction(() => {
    for (const c of expenses) ins.run(uuid(), c.name, 'expense', c.color, c.icon)
    for (const c of incomes) ins.run(uuid(), c.name, 'income', c.color, c.icon)
  })
  tx()
  console.log(`✓ Seeded ${expenses.length + incomes.length} default categories`)
} else {
  console.log(`✓ Categories already present (${count})`)
}
