import type { DamageElement } from '@/types/catalog'

export type EnemyDebuffKind = 'def' | 'res' | 'stunRes' | 'anomalyRes'

/**
 * 伤害元素全集（**不含 lumiflux**）。
 *
 * 2026-10-21 用户裁决全删：
 * > 「流明本身也没有积蓄，因此不会形成异常主人……全游戏没有流明属性进行攻击计算」
 * 官方设定流明是高级属性：流明角色（蕾米埃尔）的伤害跟随**下一位队友的属性**，
 * 耀变沿用**原主人的属性** ⇒ 引擎里不存在按流明结算的伤害，也就不需要流明抗性/弱点/增伤。
 *
 * 修前这里有 lumiflux，而 STANDARD_ENEMY_DEBUFF_ELEMENTS 又只有 6 个
 * ⇒ 同一份「元素清单」写了两遍且不一致（典型的两处实现漂移）。现合并为一份。
 */
export const DAMAGE_ELEMENTS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind'] as const
/** 敌人抗性 / 减抗认的标准元素（与 DAMAGE_ELEMENTS 同源，保留名字供既有调用点） */
export const STANDARD_ENEMY_DEBUFF_ELEMENTS = DAMAGE_ELEMENTS
/** 敌人抗性 / 减抗认的标准元素 */
export type StandardEnemyDebuffElement = typeof STANDARD_ENEMY_DEBUFF_ELEMENTS[number]
/**
 * 敌人抗性表（伤害 / 失衡 / 积蓄三张同形）：标准 6 元素各一项，缺键是类型错误（r756 CC-539）。
 * 表只从这几处来：store 默认表、Boss 预设相位（validate:data 的 JSON 契约按本类型校验 boss-presets.json）、
 * 属性页与影响变量的单元素写入——所以按 6 元素读表不写兜底。
 * 引擎读表的入参仍是 `Record<string, number>`、缺键按 0：引擎按执行行 / 异常的元素取键，键可能不在这 6 个里（失衡 / 紊乱 / 乱流三个读点各有没归到基础元素的变种，如 frostfire、ether_ink）。
 */
export type ResistanceTable = Record<StandardEnemyDebuffElement, number>

export const ELEMENT_FIELD_PREFIX: Record<string, string> = {
  physical: 'Physical',
  fire: 'Fire',
  ice: 'Ice',
  electric: 'Electric',
  ether: 'Ether',
  wind: 'Wind',
}

export const ELEMENT_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火属性',
  ice: '冰属性',
  electric: '电属性',
  ether: '以太',
  wind: '风属性',
}

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

export function normalizeEnemyDebuffStatAlias(stat: string): string {
  if (stat === 'enemyDefIgnore') return 'enemyDefReduction'
  if (stat === 'enemyResIgnore' || stat === 'allResIgnore') return 'enemyResReduction'
  if (stat === 'enemyStunResIgnore') return 'enemyStunResReduction'
  if (stat === 'enemyAnomalyResIgnore') return 'enemyAnomalyResReduction'

  const oldElementFirst = stat.match(/^(physical|fire|ice|electric|ether|wind)(Def|Res|StunRes|AnomalyRes)Ignore$/)
  if (oldElementFirst) {
    const suffix = `${oldElementFirst[2]}Ignore`
    return enemyDebuffStatId(IGNORE_SUFFIX_TO_KIND[suffix], oldElementFirst[1])
  }

  const oldEnemyPrefix = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)(Def|Res|StunRes|AnomalyRes)Ignore$/)
  if (oldEnemyPrefix) {
    const element = PREFIX_TO_ELEMENT[oldEnemyPrefix[1]]
    const suffix = `${oldEnemyPrefix[2]}Ignore`
    return enemyDebuffStatId(IGNORE_SUFFIX_TO_KIND[suffix], element)
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
