// Справочник FontAwesome 4 иконок для категорий. value — CSS-класс без префикса "fa-".
// Список подобран под типовые категории расходов/доходов.
// Полный каталог: https://fontawesome.com/v4/icons/

// Эмодзи для категорий. В БД хранится как обычная строка (Unicode-символы).
// Иконка считается "эмодзи", если не матчится под FA-формат ASCII kebab-case
// (см. iconHTML ниже).
export const CATEGORY_EMOJIS = [
  // Еда и напитки
  { value: '🍎', label: 'Фрукты' },
  { value: '🍞', label: 'Хлеб' },
  { value: '🥖', label: 'Выпечка' },
  { value: '🧀', label: 'Молочное' },
  { value: '🍗', label: 'Мясо' },
  { value: '🥩', label: 'Стейк' },
  { value: '🍔', label: 'Фастфуд' },
  { value: '🍕', label: 'Пицца' },
  { value: '🍜', label: 'Суп/лапша' },
  { value: '🍣', label: 'Суши' },
  { value: '🍱', label: 'Готовая еда' },
  { value: '🥗', label: 'Салат' },
  { value: '🍰', label: 'Десерт' },
  { value: '🍻', label: 'Бар' },
  { value: '🍷', label: 'Вино' },
  { value: '🍸', label: 'Коктейль' },
  { value: '☕', label: 'Кофе' },
  { value: '🍵', label: 'Чай' },
  // Транспорт
  { value: '🚗', label: 'Авто' },
  { value: '🚕', label: 'Такси' },
  { value: '🚌', label: 'Автобус' },
  { value: '🚆', label: 'Поезд' },
  { value: '✈️', label: 'Самолёт' },
  { value: '🚀', label: 'Перелёт' },
  { value: '⛽', label: 'Бензин' },
  { value: '🅿️', label: 'Парковка' },
  { value: '🚲', label: 'Велосипед' },
  { value: '🛵', label: 'Самокат' },
  // Дом
  { value: '🏠', label: 'Дом' },
  { value: '🛋️', label: 'Мебель' },
  { value: '🚪', label: 'Дверь/ремонт' },
  { value: '🏥', label: 'Больница' },
  { value: '🏫', label: 'Школа' },
  // Здоровье
  { value: '💊', label: 'Лекарства' },
  { value: '💉', label: 'Медицина' },
  { value: '🩺', label: 'Врач' },
  { value: '🦷', label: 'Стоматолог' },
  { value: '❤️', label: 'Здоровье' },
  // Одежда
  { value: '👕', label: 'Одежда' },
  { value: '👔', label: 'Рубашка' },
  { value: '👗', label: 'Платье' },
  { value: '👠', label: 'Обувь' },
  { value: '👟', label: 'Кроссовки' },
  { value: '💼', label: 'Портфель' },
  { value: '🎒', label: 'Рюкзак' },
  // Развлечения, культура
  { value: '🎮', label: 'Игры' },
  { value: '🎲', label: 'Настолки' },
  { value: '🎯', label: 'Хобби' },
  { value: '🎨', label: 'Творчество' },
  { value: '🎭', label: 'Театр' },
  { value: '🎬', label: 'Кино' },
  { value: '🎤', label: 'Караоке' },
  { value: '🎧', label: 'Музыка' },
  { value: '🎼', label: 'Концерт' },
  { value: '📚', label: 'Книги' },
  { value: '📖', label: 'Чтение' },
  // Деньги
  { value: '💰', label: 'Деньги' },
  { value: '💵', label: 'Наличные' },
  { value: '💳', label: 'Карта' },
  { value: '💎', label: 'Ценности' },
  { value: '🪙', label: 'Монеты' },
  { value: '🏦', label: 'Банк' },
  { value: '🏧', label: 'Банкомат' },
  { value: '📈', label: 'Инвестиции' },
  { value: '💱', label: 'Валюта' },
  // Техника
  { value: '📺', label: 'ТВ' },
  { value: '📱', label: 'Телефон' },
  { value: '💻', label: 'Ноутбук' },
  { value: '🖥️', label: 'Компьютер' },
  { value: '⌨️', label: 'Клавиатура' },
  { value: '📷', label: 'Камера' },
  // Подарки, праздники
  { value: '🎁', label: 'Подарок' },
  { value: '🎉', label: 'Праздник' },
  { value: '🎂', label: 'Торт' },
  { value: '🎄', label: 'Праздники' },
  // Питомцы
  { value: '🐶', label: 'Собака' },
  { value: '🐱', label: 'Кошка' },
  { value: '🐹', label: 'Хомяк' },
  { value: '🐰', label: 'Кролик' },
  // Инструменты
  { value: '🔧', label: 'Инструменты' },
  { value: '🔨', label: 'Молоток' },
  { value: '⚙️', label: 'Сервис' },
  { value: '🛠️', label: 'Ремонт' },
  // Природа
  { value: '🌳', label: 'Растения' },
  { value: '🌹', label: 'Цветы' },
  { value: '🏖️', label: 'Отпуск' },
  { value: '🏔️', label: 'Поход' },
  // Остальное
  { value: '⭐', label: 'Важное' },
  { value: '🔥', label: 'Срочное' },
  { value: '💡', label: 'Идея' },
  { value: '✅', label: 'Готово' },
  { value: '🎯', label: 'Цель' },
  { value: '📦', label: 'Прочее' }
]

export const CATEGORY_ICONS = [
  // Расходы — еда, дом
  { value: 'shopping-cart', label: 'Продукты' },
  { value: 'car', label: 'Транспорт' },
  { value: 'home', label: 'Жильё' },
  { value: 'bolt', label: 'Электричество' },
  { value: 'tint', label: 'Вода' },
  { value: 'fire', label: 'Газ / отопление' },
  { value: 'mobile', label: 'Связь' },
  { value: 'wifi', label: 'Интернет' },
  // Расходы — жизнь
  { value: 'medkit', label: 'Здоровье' },
  { value: 'heart', label: 'Здоровье/аптека' },
  { value: 'coffee', label: 'Кафе' },
  { value: 'cutlery', label: 'Рестораны' },
  { value: 'glass', label: 'Алкоголь' },
  { value: 'paw', label: 'Питомцы' },
  { value: 'tshirt', label: 'Одежда' },
  // Расходы — развлечения, услуги
  { value: 'film', label: 'Кино' },
  { value: 'music', label: 'Музыка' },
  { value: 'gamepad', label: 'Игры' },
  { value: 'tv', label: 'ТВ/подписки' },
  { value: 'book', label: 'Книги' },
  { value: 'graduation-cap', label: 'Образование' },
  { value: 'plane', label: 'Путешествия' },
  { value: 'gift', label: 'Подарки' },
  { value: 'briefcase', label: 'Бизнес' },
  { value: 'wrench', label: 'Услуги/ремонт' },
  { value: 'bank', label: 'Банк/комиссии' },
  { value: 'money', label: 'Наличные' },
  { value: 'credit-card', label: 'Карта/платежи' },
  // Доходы
  { value: 'suitcase', label: 'Зарплата' },
  { value: 'line-chart', label: 'Инвестиции' },
  { value: 'trophy', label: 'Подарки/бонусы' },
  { value: 'exchange', label: 'Перевод' },
  { value: 'diamond', label: 'Прочее/ценности' },
  { value: 'plus-circle', label: 'Доход' },
  // Универсальные
  { value: 'tag', label: 'Категория' },
  { value: 'star', label: 'Особое' },
  { value: 'flag', label: 'Важное' },
  { value: 'circle-o', label: 'Без иконки' }
]

// Хелпер для отображения: FA-класс → <i class="fa fa-...">, эмодзи/прочее → как есть
// Раньше эта функция безусловно оборачивала имя в <i class="fa fa-...">, и для эмодзи
// вроде "👕" получался невалидный FA-класс "fa-👕" с пустым глифом — иконка пропадала.
export function iconHTML(name, extraClass = '') {
  if (!name) return ''
  // FA4 имена: ASCII, kebab-case (например, "shopping-cart", "graduation-cap").
  // Всё остальное (эмодзи, символы) — рендерим как есть.
  if (/^[a-z][a-z0-9-]*$/.test(name)) {
    const cls = name.startsWith('fa-') ? name : `fa-${name}`
    return `<i class="fa ${cls} ${extraClass}"></i>`
  }
  return name
}

// Алиас для обратной совместимости и явности в местах вызова.
export const categoryIconHTML = iconHTML
