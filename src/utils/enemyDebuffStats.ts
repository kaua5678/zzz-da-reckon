import type { DamageElement } from '@/types/catalog'

export type EnemyDebuffKind = 'def' | 'res' | 'stunRes' | 'anomalyRes'

export const DAMAGE_ELEMENTS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind', 'lumiflux'] as const
export const STANDARD_ENEMY_DEBUFF_ELEMENTS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind'] as const

export const ELEMENT_FIELD_PREFIX: Record<string, string> = {
  physical: 'Physical',
  fire: 'Fire',
  ice: 'Ice',
  electric: 'Electric',
  ether: 'Ether',
  wind: 'Wind',
  lumiflux: 'Lumiflux',
}

export const ELEMENT_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火属性',
  ice: '冰属性',
  electric: '电属性',
  ether: '以太',
  wind: '风属性',
  lumiflux: '辉光/耀变',
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

  const oldElementFirst = stat.match(/^(physical|fire|ice|electric|ether|wind|lumiflux)(Def|Res|StunRes|AnomalyRes)Ignore$/)
  if (oldElementFirst) {
    const suffix = `${oldElementFirst[2]}Ignore`
    return enemyDebuffStatId(IGNORE_SUFFIX_TO_KIND[suffix], oldElementFirst[1])
  }

  const oldEnemyPrefix = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind|Lumiflux)(Def|Res|StunRes|AnomalyRes)Ignore$/)
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

export function isEnemyDebuffStat(stat: string): boolean {
  const normalized = normalizeEnemyDebuffStatAlias(stat)
  return GENERATED_ENEMY_DEBUFF_STAT_IDS.includes(normalized)
}
