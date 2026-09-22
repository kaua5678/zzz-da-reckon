/** Runtime boundary for imported JSON, local cache recovery and editable drafts.
 * Returns an independent, known-field-only snapshot; never coerces malformed values.
 * Missing collections may use defaults only when restoring legacy browser storage.
 */
import type { AttributeConversionRule, LogicEditorState, LogicObject, RowFusionRule } from './types'

function invalid(path: string, expected: string): never {
  throw new Error(`${path}：${expected}`)
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '必须是对象')
  return value as Record<string, unknown>
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, '必须是字符串')
  return value
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, '必须是布尔值')
  return value
}

function numberAt(value: unknown, path: string, min?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, '必须是有限数字')
  if (min !== undefined && value < min) invalid(path, `必须大于等于 ${min}`)
  return value
}

function enumAt<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(path, `必须是 ${values.join(' / ')}`)
  return value as T
}

function identityAt(value: Record<string, unknown>, path: string) {
  return {
    id: stringAt(value.id, `${path}.id`),
    name: stringAt(value.name, `${path}.name`),
    ...(value.specId === undefined ? {} : { specId: stringAt(value.specId, `${path}.specId`) }),
  }
}

function propertyValueAt(value: unknown, path: string, ancestors: Set<object>): LogicObject['properties'][string] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return numberAt(value, path)
  if (!value || typeof value !== 'object') invalid(path, '必须是有效的 JSON 值')
  if (ancestors.has(value)) invalid(path, '不能包含循环引用')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return Array.from(value, (item, i) => propertyValueAt(item, `${path}[${i}]`, ancestors))
    // fromEntries preserves an own "__proto__" key without assigning to Object.prototype.
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, propertyValueAt(item, `${path}.${key}`, ancestors)],
    ))
  } finally {
    ancestors.delete(value)
  }
}

/** Shared with the textarea; preserve existing structured spec metadata and validate every leaf. */
export function parseLogicObjectProperties(value: unknown, path = 'properties'): LogicObject['properties'] {
  return propertyValueAt(objectAt(value, path), path, new Set()) as LogicObject['properties']
}

function conversionAt(value: unknown, path: string): AttributeConversionRule {
  const rule = objectAt(value, path)
  const stepSize = numberAt(rule.stepSize, `${path}.stepSize`)
  if (stepSize <= 0) invalid(`${path}.stepSize`, '必须大于 0')
  return {
    ...identityAt(rule, path),
    sourceStat: stringAt(rule.sourceStat, `${path}.sourceStat`),
    sourcePanelPhase: enumAt(rule.sourcePanelPhase, `${path}.sourcePanelPhase`, ['outOfCombat', 'inCombat']),
    threshold: numberAt(rule.threshold, `${path}.threshold`),
    stepSize,
    targetStat: stringAt(rule.targetStat, `${path}.targetStat`),
    valuePerStep: numberAt(rule.valuePerStep, `${path}.valuePerStep`),
    cap: rule.cap === null ? null : numberAt(rule.cap, `${path}.cap`, 0),
    note: stringAt(rule.note, `${path}.note`),
  }
}

function logicObjectAt(value: unknown, path: string): LogicObject {
  const object = objectAt(value, path)
  return {
    ...identityAt(object, path),
    nature: enumAt(object.nature, `${path}.nature`, ['buff', 'resource', 'event', 'formula', 'custom']),
    enabled: booleanAt(object.enabled, `${path}.enabled`),
    properties: parseLogicObjectProperties(object.properties, `${path}.properties`),
  }
}

function fusionAt(value: unknown, path: string): RowFusionRule {
  const rule = objectAt(value, path)
  return {
    ...identityAt(rule, path),
    agentId: stringAt(rule.agentId, `${path}.agentId`),
    moveId: stringAt(rule.moveId, `${path}.moveId`),
    rowId: stringAt(rule.rowId, `${path}.rowId`),
    multiplier: numberAt(rule.multiplier, `${path}.multiplier`, 0),
    enabled: booleanAt(rule.enabled, `${path}.enabled`),
    note: stringAt(rule.note, `${path}.note`),
  }
}

export function parseLogicEditorState(value: unknown, defaults?: LogicEditorState): LogicEditorState {
  const state = objectAt(value, '配置')
  // Pre-version exports are v1; explicit unknown versions must not be silently downgraded.
  if (state.version !== undefined && state.version !== 1) invalid('version', '仅支持版本 1')
  function collection<T>(key: 'attributeConversions' | 'objects' | 'rowFusions', read: (item: unknown, path: string) => T): T[] {
    const items = state[key] ?? defaults?.[key]
    if (!Array.isArray(items)) invalid(key, '必须是数组')
    return Array.from(items, (item, index) => read(item, `${key}[${index}]`))
  }
  return {
    version: 1,
    attributeConversions: collection('attributeConversions', conversionAt),
    objects: collection('objects', logicObjectAt),
    rowFusions: collection('rowFusions', fusionAt),
  }
}
