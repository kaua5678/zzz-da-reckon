/**
 * 伤害影响分析变量注册表
 *
 * 每个变量定义：从 configStore 读取当前值，设置新值后触发响应式重算。
 * 用于 ImpactChart.vue 的 x 轴采样。
 *
 * CC-538（2026-10-09 arena-G r755）：表项自带读写（`read` / `write`）。原先表、`readImpactVar` / `writeImpactVar` 的两张 switch、
 * 抗性 id → 元素表是按同一组 id 手工对齐的四份清单，id 拼错不报（读 0、写入静默不做）；抗性缺键读 20、2 号位缺席读 1 又各写了
 * 一份默认值——store 默认抗性表与 159 个 Boss 预设阶段都六键齐全（引擎缺键按 0）、store 队伍恒为 3 格，这两处只有测试桩走得到。
 * 现在每个变量只在表里定义一次，默认值只在 store（defaultEnemy / defaultCharacter）。
 */
import type { ResistanceTable, StandardEnemyDebuffElement } from '@/utils/enemyDebuffStats'

/**
 * r407：读写影响变量所需的最小配置面（**结构类型**；Pinia configStore 天然满足，测试可传最小桩）。
 * core 不 import `@/stores/*`，所以此前用 `configStore: any`——键拼错不报。现只声明这里真正读写的成员。
 * enemy 各字段与 store 的 `EnemyConfig` 一样必填：默认值只在 store 的 defaultEnemy，这里不再各写一份（r724；桩要给全）。
 * team 同理：store 队伍恒为 3 格、每格的平A时间权重必填（CC-538）。
 */
export interface ImpactVarConfig {
  enemy: {
    stunValue: number
    invincibleTime: number
    battleTime: number
    stunVuln: number
    anomalyCoeff: number
    damageResistances: ResistanceTable
  }
  team: ReadonlyArray<{ basicAttackTimeWeight: number }>
  setEnemy(patch: { stunValue?: number; invincibleTime?: number; battleTime?: number; stunVuln?: number; anomalyCoeff?: number; damageResistances?: ResistanceTable }): void
  setActionCount(slot: number, field: 'basicAttackTimeWeight', count: number): void
}

/** 影响变量。`C` 是读写要用的配置面：静态表项只要 ImpactVarConfig，编排层的机制设置变量要整个 store（CC-538） */
export interface ImpactVariable<C = ImpactVarConfig> {
  /** 显示名称（下拉选单） */
  label: string
  /** 变量 id（下拉选项值） */
  id: string
  /** 默认采样区间 [min, max] */
  defaultRange: [number, number]
  /** 单位后缀 */
  suffix?: string
  /** 读当前值（展示单位） */
  read(config: C): number
  /** 写入新值（展示单位）；写进 store 后由响应式重算 */
  write(config: C, value: number): void
}

/** 伤害抗性变量：读写 enemy.damageResistances 的一个元素（写入经 setEnemy 换整张表，同原 writeImpactVar） */
function resistanceVar(element: StandardEnemyDebuffElement, name: string): ImpactVariable {
  return {
    id: `${element}Resistance`,
    label: `${name}伤害抗性`,
    defaultRange: [-100, 100],
    suffix: '%',
    read: config => config.enemy.damageResistances[element],
    write: (config, value) => config.setEnemy({ damageResistances: { ...config.enemy.damageResistances, [element]: value } }),
  }
}

/** 所有可用的影响变量 */
export const IMPACT_VARIABLES: ImpactVariable[] = [
  {
    id: 'bossStunValue',
    label: 'Boss 失衡值阈值',
    defaultRange: [500, 8000],
    suffix: '',
    read: config => config.enemy.stunValue,
    write: (config, value) => config.setEnemy({ stunValue: value }),
  },
  {
    id: 'bossInvincible',
    label: 'Boss 无敌时间（秒）',
    defaultRange: [0, 120],
    suffix: 's',
    read: config => config.enemy.invincibleTime,
    write: (config, value) => config.setEnemy({ invincibleTime: value }),
  },
  {
    id: 'totalTime',
    label: '总战斗时间（秒）',
    defaultRange: [60, 300],
    suffix: 's',
    read: config => config.enemy.battleTime,
    write: (config, value) => config.setEnemy({ battleTime: value }),
  },
  {
    id: 'stunVulnerability',
    label: '失衡易伤倍率',
    defaultRange: [1.0, 2.0],
    suffix: '×',
    read: config => config.enemy.stunVuln,
    write: (config, value) => config.setEnemy({ stunVuln: value }),
  },
  {
    id: 'anomalyCoeff',
    label: '异常条系数',
    defaultRange: [0.5, 2.0],
    suffix: '×',
    read: config => config.enemy.anomalyCoeff,
    write: (config, value) => config.setEnemy({ anomalyCoeff: value }),
  },
  resistanceVar('physical', '物理'),
  resistanceVar('fire', '火'),
  resistanceVar('ice', '冰'),
  resistanceVar('electric', '电'),
  resistanceVar('ether', '以太'),
  resistanceVar('wind', '风'),
  {
    id: 'slot1TimeWeight',
    label: '2号队友 平A时间权重（战场时间占比）',
    defaultRange: [0, 99],
    suffix: '',
    read: config => config.team[1].basicAttackTimeWeight,
    write: (config, value) => config.setActionCount(1, 'basicAttackTimeWeight', value),
  },
  // TODO: 队伍角色攻击（需从 panel 读取），目前注释待扩展
  // { id: 'slot1Atk', label: '角色1攻击力', defaultRange: [1000, 5000], suffix: '' },
]
