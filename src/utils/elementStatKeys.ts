import type { PanelValues } from '@/types/catalog'
import { resolveStatElement } from '@/data/anomalyElement'
import { ELEMENT_FIELD_PREFIX, enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'

/**
 * 元素 → 面板字段名（单一来源，CC-224）。
 *
 * 一律先经 `resolveStatElement` 解析：变种元素（physical_polar_assault / ether_ink）读基础元素，烈霜 frostfire 读冰
 * （用户口径 2026-09-05「烈霜在一切元素→数值查找里按冰读」）。无对应字段的元素返回 undefined（调用方按 0 处理，
 * **不得**回落到通用字段——FinalPanel 旧写法 `?? 'dmgBonus'` 会把通用增伤算两遍）。
 *
 * CC-224 前的副本：`core/elementKeys.ts` 三张表（缺 ether_ink / frostfire ⇒ 仪玄玄墨、雅烈霜的异常虚拟面板漏元素增伤与元素减抗）、
 * `core/damage.ts#getElementDmgBonus` 局部表、`core/anomalyPool/helpers.ts#getElementDmgKey` switch、
 * FinalPanel 4 张、StatPanel 2 张、ResourceUtilizationPage 1 张。
 * 源码锁：`src/utils/__tests__/elementStatKeys.test.ts`。
 */
export type ElementStatKind = 'dmg' | 'critDmg' | 'sheerDmg' | 'sharpDmg' | 'enemyRes' | 'enemyDef'

const OWN_SUFFIX: Record<Exclude<ElementStatKind, 'enemyRes' | 'enemyDef'>, string> = {
  dmg: 'Dmg',
  critDmg: 'CritDmg',
  sheerDmg: 'SheerDmg',
  sharpDmg: 'SharpDmg',
}

export function elementStatKey(kind: ElementStatKind, element?: string): string | undefined {
  const e = resolveStatElement(element)
  if (!e || !ELEMENT_FIELD_PREFIX[e]) return undefined
  if (kind === 'enemyRes') return enemyDebuffElementStatId('res', e)
  if (kind === 'enemyDef') return enemyDebuffElementStatId('def', e)
  return `${e}${OWN_SUFFIX[kind]}`
}

/** 读面板上该元素的字段值；元素无对应字段 ⇒ 0 */
export function panelElementStat(panel: PanelValues, kind: ElementStatKind, element?: string): number {
  const key = elementStatKey(kind, element)
  return key ? ((panel as unknown as Record<string, number | undefined>)[key] ?? 0) : 0
}
