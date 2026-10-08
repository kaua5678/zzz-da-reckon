import { getPanelStat } from '@/utils/panelStat'
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
export type ElementStatKind =
  | 'dmg'
  | 'critDmg'
  | 'sheerDmg'
  | 'sharpDmg'
  | 'enemyRes'
  | 'enemyDef'
  | 'enemyAnomalyRes'
  | 'enemyStunRes'

const OWN_SUFFIX: Record<Exclude<ElementStatKind, 'enemyRes' | 'enemyDef' | 'enemyAnomalyRes' | 'enemyStunRes'>, string> = {
  dmg: 'Dmg',
  critDmg: 'CritDmg',
  sheerDmg: 'SheerDmg',
  sharpDmg: 'SharpDmg',
}

export function elementStatKey(kind: ElementStatKind, element?: string | null): string | undefined {
  const e = resolveStatElement(element ?? undefined)
  if (!e || !ELEMENT_FIELD_PREFIX[e]) return undefined
  if (kind === 'enemyRes') return enemyDebuffElementStatId('res', e)
  if (kind === 'enemyDef') return enemyDebuffElementStatId('def', e)
  if (kind === 'enemyAnomalyRes') return enemyDebuffElementStatId('anomalyRes', e)
  if (kind === 'enemyStunRes') return enemyDebuffElementStatId('stunRes', e)
  return `${e}${OWN_SUFFIX[kind]}`
}

/** 读面板上该元素的字段值；元素无对应字段 ⇒ 0 */
export function panelElementStat(panel: PanelValues, kind: ElementStatKind, element?: string): number {
  const key = elementStatKey(kind, element)
  return key ? (getPanelStat(panel, key) ?? 0) : 0
}

/**
 * 敌人抗性表按元素取值（伤害 / 失衡 / 积蓄三张表同一读法，r757 CC-540）：键与上面的元素减抗字段同口径，先经
 * `resolveStatElement`——变种读基础元素，烈霜读冰（敌方冰抗属于「元素→数值」查找，用户口径 2026-09-05）。
 * 表里没有该元素（lumiflux）⇒ 0。此前 8 处读点三种口径：积蓄 / 直伤按 resolveStatElement；紊乱按 getBaseElement
 * （那是异常身份口径，烈霜不归冰）；失衡 / 乱流 / 蕾米埃尔按原始元素（变种全查不到）——同一结算里抗性与减抗按不同元素取。
 */
export function enemyResistanceOf(table: Readonly<Record<string, number>>, element: string | undefined): number {
  return table[resolveStatElement(element) ?? ''] ?? 0
}
