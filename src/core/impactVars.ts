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

/**
 * 从 configStore 读取变量当前值。
 */
export function readImpactVar(configStore: any, varId: string): number {
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
    case 'physicalResistance':
      return configStore.enemy.damageResistances?.physical ?? configStore.enemy.resistances?.physical ?? 20
    case 'fireResistance':
      return configStore.enemy.damageResistances?.fire ?? configStore.enemy.resistances?.fire ?? 20
    case 'iceResistance':
      return configStore.enemy.damageResistances?.ice ?? configStore.enemy.resistances?.ice ?? 20
    case 'electricResistance':
      return configStore.enemy.damageResistances?.electric ?? configStore.enemy.resistances?.electric ?? 20
    case 'etherResistance':
      return configStore.enemy.damageResistances?.ether ?? configStore.enemy.resistances?.ether ?? 20
    case 'windResistance':
      return configStore.enemy.damageResistances?.wind ?? configStore.enemy.resistances?.wind ?? 20
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
    case 'physicalResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.physical = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'fireResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.fire = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'iceResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.ice = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'electricResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.electric = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'etherResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.ether = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'windResistance': {
      const current = { ...(configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}) }
      current.wind = value
      configStore.setEnemy({ damageResistances: current })
      break
    }
    case 'slot1TimeWeight':
      configStore.setBasicAttackTimeWeight(1, value)
      break
  }
}
