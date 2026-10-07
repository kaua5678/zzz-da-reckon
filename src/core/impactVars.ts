/**
 * 伤害影响分析变量注册表
 *
 * 每个变量定义：从 configStore 读取当前值，设置新值后触发响应式重算。
 * 用于 ImpactChart.vue 的 x 轴采样。
 */

/**
 * r407：读写影响变量所需的最小配置面（**结构类型**；Pinia configStore 天然满足，测试可传最小桩）。
 * core 不 import `@/stores/*`，所以此前用 `configStore: any`——键拼错不报。现只声明这里真正读写的成员。
 * enemy 各字段与 store 的 `EnemyConfig` 一样必填：默认值只在 store 的 defaultEnemy，这里不再各写一份（r724；桩要给全）。
 */
export interface ImpactVarConfig {
  enemy: {
    stunValue: number
    invincibleTime: number
    battleTime: number
    stunVuln: number
    anomalyCoeff: number
    damageResistances: Record<string, number>
  }
  team?: ReadonlyArray<{ basicAttackTimeWeight?: number } | undefined>
  setEnemy(patch: { stunValue?: number; invincibleTime?: number; battleTime?: number; stunVuln?: number; anomalyCoeff?: number; damageResistances?: Record<string, number> }): void
  setActionCount(slot: number, field: 'basicAttackTimeWeight', count: number): void
}

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
export function readImpactVar(configStore: ImpactVarConfig, varId: string): number {
  const resEl = RESISTANCE_VAR_ELEMENTS[varId]
  if (resEl) {
    return configStore.enemy.damageResistances[resEl] ?? 20
  }
  switch (varId) {
    case 'bossStunValue':
      return configStore.enemy.stunValue
    case 'bossInvincible':
      return configStore.enemy.invincibleTime
    case 'totalTime':
      return configStore.enemy.battleTime
    case 'stunVulnerability':
      return configStore.enemy.stunVuln
    case 'anomalyCoeff':
      return configStore.enemy.anomalyCoeff
    case 'slot1TimeWeight':
      return configStore.team?.[1]?.basicAttackTimeWeight ?? 1
    default:
      return 0
  }
}

/**
 * 向 configStore 写入变量值。
 */
export function writeImpactVar(configStore: ImpactVarConfig, varId: string, value: number): void {
  const resEl = RESISTANCE_VAR_ELEMENTS[varId]
  if (resEl) {
    const current = { ...configStore.enemy.damageResistances }
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
      configStore.setActionCount(1, 'basicAttackTimeWeight', value)
      break
  }
}
