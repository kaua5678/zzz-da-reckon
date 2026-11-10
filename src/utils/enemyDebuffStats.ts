import type { DamageElement } from '@/types/catalog'
import {
  DAMAGE_ELEMENTS,
  ELEMENT_FIELD_PREFIX,
  ELEMENT_LABEL,
  STANDARD_ENEMY_DEBUFF_ELEMENTS,
  type StandardEnemyDebuffElement,
} from '@/utils/damageElements'
import { resIgnoreStatId } from '@/utils/resistanceChannels'

export type EnemyDebuffKind = 'def' | 'res' | 'stunRes' | 'anomalyRes'

// 元素常量已下沉到叶子模块 `utils/damageElements`（2026-11-09 三通道重构：断开与
// `resistanceChannels` 的**模块初始化环**）。这里原样再导出，既有调用点不用改。
export { DAMAGE_ELEMENTS, ELEMENT_FIELD_PREFIX, ELEMENT_LABEL, STANDARD_ENEMY_DEBUFF_ELEMENTS }
export type { StandardEnemyDebuffElement }

/**
 * 敌人抗性表（伤害 / 失衡 / 积蓄三张同形）：标准 6 元素各一项，缺键是类型错误（r756 CC-539）。
 * 表只从这几处来：store 默认表、Boss 预设相位（validate:data 的 JSON 契约按本类型校验 boss-presets.json）、
 * 属性页与影响变量的单元素写入——所以按 6 元素读表不写兜底。
 * 引擎读表的入参仍是 `Record<string, number>`、缺键按 0：引擎按执行行 / 异常的元素取键，键可能不在这 6 个里（失衡 / 紊乱 / 乱流三个读点各有没归到基础元素的变种，如 frostfire、ether_ink）。
 */
export type ResistanceTable = Record<StandardEnemyDebuffElement, number>

export const ENEMY_DEBUFF_KIND_CONFIG: Record<EnemyDebuffKind, {
  baseStat: string
  suffix: string
  legacyIgnoreSuffix: string
  label: string
  description: string
}> = {
  def: {
    baseStat: 'enemyDefReduction',
    suffix: 'DefReduction',
    legacyIgnoreSuffix: 'DefIgnore',
    label: '敌方防御降低/无视防御',
    description: '进入防御区，与减防/无视防御加算，不是独立乘区',
  },
  res: {
    baseStat: 'enemyResReduction',
    suffix: 'ResReduction',
    legacyIgnoreSuffix: 'ResIgnore',
    label: '伤害抗性降低/无视抗性',
    description: '进入伤害抗性区，与减抗/无视抗性加算，不是独立乘区',
  },
  stunRes: {
    baseStat: 'enemyStunResReduction',
    suffix: 'StunResReduction',
    legacyIgnoreSuffix: 'StunResIgnore',
    label: '失衡抗性降低/无视',
    description: '进入失衡抗性区，与失衡抗性降低/无视加算',
  },
  anomalyRes: {
    baseStat: 'enemyAnomalyResReduction',
    suffix: 'AnomalyResReduction',
    legacyIgnoreSuffix: 'AnomalyResIgnore',
    label: '积蓄抗性降低/无视',
    description: '进入异常积蓄抗性区，与积蓄抗性降低/无视加算',
  },
}

const PREFIX_TO_ELEMENT = Object.fromEntries(
  Object.entries(ELEMENT_FIELD_PREFIX).map(([element, prefix]) => [prefix, element]),
) as Record<string, DamageElement>

const IGNORE_SUFFIX_TO_KIND: Record<string, EnemyDebuffKind> = {
  DefIgnore: 'def',
  ResIgnore: 'res',
  StunResIgnore: 'stunRes',
  AnomalyResIgnore: 'anomalyRes',
}

export function enemyDebuffStatId(kind: EnemyDebuffKind, element?: string): string {
  const config = ENEMY_DEBUFF_KIND_CONFIG[kind]
  if (!element || element === 'all') return config.baseStat
  const prefix = ELEMENT_FIELD_PREFIX[element]
  return prefix ? `enemy${prefix}${config.suffix}` : config.baseStat
}

export function enemyDebuffElementStatId(kind: EnemyDebuffKind, element?: string): string | undefined {
  if (!element || element === 'all') return undefined
  const prefix = ELEMENT_FIELD_PREFIX[element]
  return prefix ? `enemy${prefix}${ENEMY_DEBUFF_KIND_CONFIG[kind].suffix}` : undefined
}

/**
 * 旧写法（`*Ignore`）→ 现名的归一层。
 *
 * ⚠ **抗性族的两处修正（2026-11-09 三通道）**：`*ResIgnore` 的字面语义是「**无视**抗性」
 * （自身造成伤害时无视），按用户口径它**只作用于直伤**、不降低 boss 身上的乘区 ⇒ 必须归到
 * `enemy{El}ResIgnoreDirect`，不能像修前那样归进 `enemy{El}ResReduction`（怪物减抗，异常也吃）。
 * 修前 `enemyResIgnore → enemyResReduction` 正是「两类语义被合并」的旧别名层，异常因此白吃。
 *
 * 失衡抗性 / 积蓄抗性**不在此列**：那两族没有「自身 vs 怪物」的二分（`Ignore` 与 `Reduction`
 * 本就是同一机制的两措辞），照旧归一。
 */
export function normalizeEnemyDebuffStatAlias(stat: string): string {
  if (stat === 'enemyDefIgnore') return 'enemyDefReduction'
  // 抗性「无视」⇒ 自身直伤族（元素限定 = enemyFireResIgnoreDirect）
  if (stat === 'enemyResIgnore' || stat === 'allResIgnore') return 'enemyResIgnoreDirect'
  if (stat === 'enemyStunResIgnore') return 'enemyStunResReduction'
  if (stat === 'enemyAnomalyResIgnore') return 'enemyAnomalyResReduction'

  const oldElementFirst = stat.match(/^(physical|fire|ice|electric|ether|wind)(Def|Res|StunRes|AnomalyRes)Ignore$/)
  if (oldElementFirst) {
    const kind = IGNORE_SUFFIX_TO_KIND[`${oldElementFirst[2]}Ignore`]
    // res 族：词义是「无视抗性」⇒ 自身直伤族（不归怪物减抗）
    if (kind === 'res') return resIgnoreStatId('direct', oldElementFirst[1])
    return enemyDebuffStatId(kind, oldElementFirst[1])
  }

  const oldEnemyPrefix = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)(Def|Res|StunRes|AnomalyRes)Ignore$/)
  if (oldEnemyPrefix) {
    const element = PREFIX_TO_ELEMENT[oldEnemyPrefix[1]]
    const kind = IGNORE_SUFFIX_TO_KIND[`${oldEnemyPrefix[2]}Ignore`]
    if (kind === 'res') return resIgnoreStatId('direct', element)
    return enemyDebuffStatId(kind, element)
  }

  return stat
}

export const GENERATED_ENEMY_DEBUFF_STAT_IDS = [
  ...Object.values(ENEMY_DEBUFF_KIND_CONFIG).map(config => config.baseStat),
  ...DAMAGE_ELEMENTS.flatMap(element =>
    (Object.keys(ENEMY_DEBUFF_KIND_CONFIG) as EnemyDebuffKind[]).map(kind => enemyDebuffStatId(kind, element)),
  ),
]

export const LEGACY_ENEMY_DEBUFF_STAT_IDS = [
  'enemyDefIgnore',
  'enemyResIgnore',
  'allResIgnore',
  'enemyStunResIgnore',
  'enemyAnomalyResIgnore',
  ...DAMAGE_ELEMENTS.flatMap(element =>
    Object.values(ENEMY_DEBUFF_KIND_CONFIG).map(config => `${element}${config.legacyIgnoreSuffix}`),
  ),
]
