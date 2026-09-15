// Подбор категории для импортированной операции по правилам import_rules.
//
// Порядок применения:
//   1. Все правила сортируются по `priority ASC` (меньше = выше приоритет).
//   2. Внутри одной группы `priority` счёт-специфичные правила
//      (accountId = конкретный счёт) идут раньше глобальных (accountId IS NULL).
//   3. Первое совпадшее правило определяет категорию.
//
// Типы матчей:
//   - merchantName         — точное равенство (case-insensitive, trimmed).
//   - mcc                  — точное равенство 4-значного кода.
//   - descriptionRegex     — RegExp(matchValue).test(description).
//   - merchantId           — точное равенство terminalId (для будущих правил).
//
// Возвращаем объект { categoryId, rule } либо null, если ничего не сработало.
// `rule` — прикладное правило (для UI-подсказки «откуда взялась категория»).

import db from '../db.js'

/**
 * Загружает все активные правила, применимые к счёту
 * (глобальные + счёт-специфичные). Сортирует по приоритету.
 * @param {string|null} accountId
 * @returns {Array<{id, accountId, matchType, matchValue, categoryId, priority}>}
 */
export function loadRules(accountId = null) {
  const rows = db.prepare(`
    SELECT id, accountId, matchType, matchValue, categoryId, priority
      FROM import_rules
     WHERE accountId IS NULL OR accountId = ?
     ORDER BY priority ASC, (accountId IS NULL) ASC
  `).all(accountId)
  return rows
}

/**
 * Подбирает категорию для операции.
 * @param {object} operation  результат parseAlfaStatement: { mcc, merchantName, description, terminalId, ... }
 * @param {Array} rules       массив из loadRules()
 * @returns {{categoryId: string, rule: object} | null}
 */
export function suggestCategory(operation, rules) {
  const merchant = (operation.merchantName || '').trim().toLowerCase()
  const mcc = String(operation.mcc || '').trim()
  const description = operation.description || ''
  const terminalId = String(operation.terminalId || '').trim()

  for (const rule of rules) {
    if (ruleMatches(rule, { merchant, mcc, description, terminalId })) {
      return { categoryId: rule.categoryId, rule }
    }
  }
  return null
}

function ruleMatches(rule, op) {
  switch (rule.matchType) {
    case 'merchantName':
      return op.merchant === rule.matchValue.trim().toLowerCase()
    case 'mcc':
      return op.mcc === rule.matchValue.trim()
    case 'descriptionRegex':
      try {
        return new RegExp(rule.matchValue, 'i').test(op.description)
      } catch {
        // Некорректный regex — не падаем, просто пропускаем правило.
        return false
      }
    case 'merchantId':
      return op.terminalId === rule.matchValue.trim()
    default:
      return false
  }
}

/**
 * Удобный helper для routes/import.js: загрузить правила и применить к массиву операций.
 * Возвращает операции с добавленным полем `suggestedCategoryId` и `matchedRule`.
 */
export function applyRulesToOperations(operations, accountId) {
  const rules = loadRules(accountId)
  return operations.map(op => {
    const result = suggestCategory(op, rules)
    return {
      ...op,
      suggestedCategoryId: result ? result.categoryId : null,
      matchedRule: result ? {
        id: result.rule.id,
        matchType: result.rule.matchType,
        matchValue: result.rule.matchValue,
        priority: result.rule.priority
      } : null
    }
  })
}

/**
 * Применяет правила к операциям, у которых УЖЕ проставлен `resolvedAccountId`.
 *
 * Нужно на этапе preview: в одной выписке операции разных счетов, а
 * `loadRules(accountId)` умеет отдавать и глобальные, и счёт-специфичные
 * правила. Раньше preview звал `applyRulesToOperations(ops, null)` — и
 * счёт-специфичные правила (а именно их и создаёт UI по галочке
 * «Сохранить как правило») вообще не применялись.
 *
 * Если правило не сработало, уже существующая подсказка (например, категория
 * банка из выписки) НЕ затирается.
 */
export function applyRulesToResolvedOperations(operations) {
  const cache = new Map()
  return operations.map(op => {
    // У перевода категории нет по смыслу — правила к нему не применяем.
    if (op.type === 'transfer') return op
    const accountId = op.resolvedAccountId || null
    let rules = cache.get(accountId)
    if (rules === undefined) {
      rules = loadRules(accountId)
      cache.set(accountId, rules)
    }
    const result = suggestCategory(op, rules)
    if (!result) return op
    return {
      ...op,
      suggestedCategoryId: result.categoryId,
      matchedRule: {
        id: result.rule.id,
        matchType: result.rule.matchType,
        matchValue: result.rule.matchValue,
        priority: result.rule.priority
      }
    }
  })
}