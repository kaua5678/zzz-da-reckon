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
 *
 * 2026-10-25（用户：可选变量太少，「比如 boss 防御就没让选」）：补齐**引擎真正消费的 Boss / 环境字段**，并给表项加 `group`
 * 供下拉分组（分组只影响呈现；采样口径仍是「变量在自己的 defaultRange 上等距取点」）。
 * 收录判据 = 该字段在求值链上有消费者（`impactVariableEffects.test.ts` 逐条采样证明曲线非平）；
 * **不收**的三个字段及理由（同测试里的反向断言：字段将来有了消费者会立刻红）：
 * - `hp`：只被消费端拿去做「伤害 ÷ 血量」派生（`composables/freeCompare/metrics.ts`），伤害链零读取 ⇒ 采样只会得到一条平线；
 * - `level`：等级系数是常量 `LEVEL_COEFF_60`（`core/damageMultipliers.ts`），引擎不读 enemy.level（只有 applyBossPreset 写入）；
 * - `bodySize`：分类值（small/medium/large），数值采样轴表达不了。
 */
import { STANDARD_ENEMY_DEBUFF_ELEMENTS, type ResistanceTable, type StandardEnemyDebuffElement } from '@/utils/enemyDebuffStats'
import { damageElementLabel } from '@/utils/agentLabelMaps'

/**
 * r407：读写影响变量所需的最小配置面（**结构类型**；Pinia configStore 天然满足，测试可传最小桩）。
 * core 不 import `@/stores/*`，所以此前用 `configStore: any`——键拼错不报。现只声明这里真正读写的成员。
 * enemy 各字段与 store 的 `EnemyConfig` 一样必填：默认值只在 store 的 defaultEnemy，这里不再各写一份（r724；桩要给全）。
 * team 同理：store 队伍恒为 3 格、每格的平A时间权重必填（CC-538）。
 */
export interface ImpactVarConfig {
  enemy: {
    stunValue: number
    stunTime: number
    invincibleTime: number
    battleTime: number
    stunVuln: number
    anomalyCoeff: number
    bossAnomalyCoeff: number
    bossStunGift: number
    defense: number
    shieldCount: number
    energyShield: number
    damageResistances: ResistanceTable
    stunResistances: ResistanceTable
    anomalyResistances: ResistanceTable
  }
  team: ReadonlyArray<{ basicAttackTimeWeight: number }>
  /** 写入面 = 上面 enemy 的可选补丁（patch 形状不再另抄一份） */
  setEnemy(patch: Partial<ImpactVarConfig['enemy']>): void
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
  /**
   * 下拉分组（只影响呈现；采样仍按 defaultRange 等距取点）。组顺序 = 表内首次出现顺序，
   * 所以静态表按分组连续排列即可，不需要另立一张组名表（动态变量一律「角色机制设置」）。
   */
  group: string
  /** 读当前值（展示单位） */
  read(config: C): number
  /** 写入新值（展示单位）；写进 store 后由响应式重算 */
  write(config: C, value: number): void
}

/** enemy 里可做数值采样轴的字段（类型上排除抗性表 / 体型 / 弱点） */
type EnemyNumberKey = 'stunValue' | 'stunTime' | 'invincibleTime' | 'battleTime' | 'stunVuln'
  | 'anomalyCoeff' | 'bossAnomalyCoeff' | 'bossStunGift' | 'defense' | 'shieldCount' | 'energyShield'

/** Boss / 环境数值变量：读写 enemy 的一个数值字段（键名只在 EnemyNumberKey 声明一次） */
function enemyNumberVar(
  id: string,
  label: string,
  key: EnemyNumberKey,
  group: string,
  defaultRange: [number, number],
  suffix?: string,
): ImpactVariable {
  return {
    id, label, group, defaultRange, suffix,
    read: config => config.enemy[key],
    write: (config, value) => config.setEnemy({ [key]: value }),
  }
}

/** 抗性三表（伤害 / 失衡 / 积蓄）的元素 → 中文名：元素清单与中文名都走单一来源（不另抄一份六元素表） */
const RES_ELEMENTS: ReadonlyArray<[StandardEnemyDebuffElement, string]> =
  STANDARD_ENEMY_DEBUFF_ELEMENTS.map(element => [element, damageElementLabel(element)])

/** 抗性变量：读写某张表的一个元素（写入经 setEnemy 换整张表，同原 resistanceVar） */
function resistanceVar(element: StandardEnemyDebuffElement, name: string, kind: 'damage' | 'stun' | 'anomaly'): ImpactVariable {
  const table = kind === 'damage' ? 'damageResistances' : kind === 'stun' ? 'stunResistances' : 'anomalyResistances'
  const kindLabel = kind === 'damage' ? '伤害' : kind === 'stun' ? '失衡' : '积蓄'
  const kindSuffix = kind === 'damage' ? '' : kind === 'stun' ? 'Stun' : 'Anomaly'
  return {
    id: element + kindSuffix + 'Resistance',
    label: name + kindLabel + '抗性',
    group: '抗性',
    defaultRange: [-100, 100],
    suffix: '%',
    read: config => config.enemy[table][element],
    write: (config, value) => config.setEnemy({ [table]: { ...config.enemy[table], [element]: value } }),
  }
}

/** 平A时间权重变量（三格同形）：读写 team[slot].basicAttackTimeWeight */
function timeWeightVar(slot: 0 | 1 | 2, label: string): ImpactVariable {
  return {
    id: 'slot' + slot + 'TimeWeight',
    label,
    group: '队伍时间分配',
    defaultRange: [0, 99],
    read: config => config.team[slot].basicAttackTimeWeight,
    write: (config, value) => config.setActionCount(slot, 'basicAttackTimeWeight', value),
  }
}

/**
 * @fact engine:影响分析/变量收录 口径: 采样轴的收录判据 = 该字段在求值链上有消费者（不是「面板有这一栏」）——每条变量由 impactVariableEffects.test.ts 两端采样证明会改结果，`*失衡抗性` 的观测通道是失衡池总失衡值而非总伤（次数取整后总伤可不变）；hp / level / bodySize 不收录（hp 只被消费端做伤害÷血量派生、等级系数是常量 LEVEL_COEFF_60、体型是分类值）；采样区间必须覆盖 boss-presets 相位的真实取值域 | 据 用户@2026-10-25「可选变量太少，比如 boss 防御就没让选」 | 验 src/composables/__tests__/impactVariableEffects.test.ts | 锚 src/core/impactVars.ts#IMPACT_VARIABLES | 信 确认
 * ⟳复核: 引擎新增读 enemy.hp / enemy.level / enemy.bodySize 的伤害侧消费者时（判据 ② 会同时变红）→ 把该字段加进表并把 ② 的反向断言改成正向 | 到期 2027-04-25
 */
/** 所有可用的影响变量（顺序 = 下拉分组顺序，组内按此处顺序） */
export const IMPACT_VARIABLES: ImpactVariable[] = [
  // ── Boss 数值 ──
  // 区间以 159 个预设相位的实测域为准（14068~23277，见 impactVariableEffects.test.ts 的「采样区间覆盖真实域」）；
  // 旧区间 [500, 8000] 整段落在真实域之外，采样出来的曲线对当前 Boss 没有参考意义。
  enemyNumberVar('bossStunValue', 'Boss 失衡值阈值', 'stunValue', 'Boss 数值', [8000, 25000]),
  enemyNumberVar('defense', '怪物防御', 'defense', 'Boss 数值', [0, 2000]),
  enemyNumberVar('stunTime', 'Boss 失衡时间（秒）', 'stunTime', 'Boss 数值', [0, 30], 's'),
  enemyNumberVar('stunVulnerability', '失衡易伤倍率', 'stunVuln', 'Boss 数值', [1.0, 2.0], '×'),
  enemyNumberVar('bossStunGift', 'Boss 赠送失衡', 'bossStunGift', 'Boss 数值', [0, 20000]),
  enemyNumberVar('shieldCount', '秽盾数量', 'shieldCount', 'Boss 数值', [0, 4]),
  enemyNumberVar('energyShield', '能量盾数量', 'energyShield', 'Boss 数值', [0, 4]),
  enemyNumberVar('anomalyCoeff', '异常条系数', 'anomalyCoeff', 'Boss 数值', [0.5, 2.0], '×'),
  enemyNumberVar('bossAnomalyCoeff', '危局异常系数', 'bossAnomalyCoeff', 'Boss 数值', [0.5, 2.0], '×'),
  // ── 战斗环境 ──
  enemyNumberVar('bossInvincible', 'Boss 无敌时间（秒）', 'invincibleTime', '战斗环境', [0, 120], 's'),
  enemyNumberVar('totalTime', '总战斗时间（秒）', 'battleTime', '战斗环境', [60, 300], 's'),
  // ── 抗性（三张表 × 6 元素）──
  ...RES_ELEMENTS.map(([element, name]) => resistanceVar(element, name, 'damage')),
  ...RES_ELEMENTS.map(([element, name]) => resistanceVar(element, name, 'stun')),
  ...RES_ELEMENTS.map(([element, name]) => resistanceVar(element, name, 'anomaly')),
  // ── 队伍时间分配 ──
  timeWeightVar(0, '1号队友 平A时间权重（战场时间占比）'),
  timeWeightVar(1, '2号队友 平A时间权重（战场时间占比）'),
  timeWeightVar(2, '3号队友 平A时间权重（战场时间占比）'),
  // TODO: 队伍角色攻击（需从 panel 读取），目前注释待扩展
]
