/**
 * 伤害影响分析变量注册表
 *
 * 每个变量定义：从 configStore 读取当前值，设置新值后触发响应式重算。
 * 用于 ImpactChart.vue 的 x 轴采样。
 */

export interface ImpactVariable {
  /** 显示名称（下拉选单） */
  label: string
  /** 只读/可写标记 */
  id: string
  /** 默认采样区间 [min, max] */
  defaultRange: [number, number]
  /** 单位后缀 */
  suffix?: string
}

/** 所有可用的影响变量 */
export const IMPACT_VARIABLES: ImpactVariable[] = [
  {
    id: 'bossStunValue',
    label: 'Boss 失衡值阈值',
    defaultRange: [500, 8000],
    suffix: '',
  },
  {
    id: 'bossInvincible',
    label: 'Boss 无敌时间（秒）',
    defaultRange: [0, 120],
    suffix: 's',
  },
  {
    id: 'totalTime',
    label: '总战斗时间（秒）',
    defaultRange: [60, 300],
    suffix: 's',
  },
  {
    id: 'stunVulnerability',
    label: '失衡易伤倍率',
    defaultRange: [1.0, 2.0],
    suffix: '×',
  },
  {
    id: 'anomalyCoeff',
    label: '异常条系数',
    defaultRange: [0.5, 2.0],
    suffix: '×',
  },
  {
    id: 'physicalResistance',
    label: '物理伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'fireResistance',
    label: '火伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'iceResistance',
    label: '冰伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'electricResistance',
    label: '电伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'etherResistance',
    label: '以太伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'windResistance',
    label: '风伤害抗性',
    defaultRange: [-100, 100],
    suffix: '%',
  },
  {
    id: 'slot1TimeWeight',
    label: '2号队友 平A时间权重（战场时间占比）',
    defaultRange: [0, 99],
    suffix: '',
  },
  // TODO: 队伍角色攻击（需从 panel 读取），目前注释待扩展
  // { id: 'slot1Atk', label: '角色1攻击力', defaultRange: [1000, 5000], suffix: '' },
]

const RESISTANCE_VAR_ELEMENTS: Readonly<Record<string, string>> = {
  physicalResistance: 'physical',
  fireResistance: 'fire',
  iceResistance: 'ice',
  electricResistance: 'electric',
  etherResistance: 'ether',
  windResistance: 'wind',
}

/**
 * 从 configStore 读取变量当前值。
 */
export function readImpactVar(configStore: any, varId: string): number {
  const resEl = RESISTANCE_VAR_ELEMENTS[varId]
  if (resEl) {
    return configStore.enemy.damageResistances?.[resEl] ?? configStore.enemy.resistances?.[resEl] ?? 20
  }
  switch (varId) {
    case 'bossStunValue':
      return configStore.enemy.stunValue
    case 'bossInvincible':
      return configStore.enemy.invincibleTime ?? 0
    case 'totalTime':
      return configStore.enemy.battleTime ?? 180
    case 'stunVulnerability':
      return configStore.enemy.stunVuln ?? 1.5
    case 'anomalyCoeff':
      return configStore.enemy.anomalyCoeff ?? 1
    case 'slot1TimeWeight':
      return configStore.team?.[1]?.basicAttackTimeWeight ?? 1
    default:
      return 0
  }
}

/**
 * 向 configStore 写入变量值。
 */
export function writeImpactVar(configStore: any, varId: string, value: number): void {
  const resEl = RESISTANCE_VAR_ELEMENTS[varId]
  if (resEl) {
    const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
    current[resEl] = value
    configStore.setEnemy({ damageResistances: current })
    return
  }
  switch (varId) {
    case 'bossStunValue':
      configStore.setEnemy({ stunValue: value })
      break
    case 'bossInvincible':
      configStore.setEnemy({ invincibleTime: value })
      break
    case 'totalTime':
      configStore.setEnemy({ battleTime: value })
      break
    case 'stunVulnerability':
      configStore.setEnemy({ stunVuln: value })
      break
    case 'anomalyCoeff':
      configStore.setEnemy({ anomalyCoeff: value })
      break
    case 'slot1TimeWeight':
      configStore.setBasicAttackTimeWeight(1, value)
      break
  }
}
