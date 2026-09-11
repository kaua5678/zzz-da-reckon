/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：失衡池 / 积蓄池 / 异常覆盖率 / 紊乱 / 乱流 / 失衡轴
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { VelinaCorrosionSource } from './agentResources'

// ============ 失衡池 ============

/** 单个招式的失衡贡献记录 */
export interface StunContribution {
  /** 招式 move id */
  moveId: string
  /** 招式名称 */
  moveName: string
  /** 角色 slot */
  slot: number
  /** 执行次数 */
  count: number
  /** 基础失衡倍率（从倍率表 daze row 提取） */
  baseDaze: number
  /** 单次实际失衡值（经过乘区计算后） */
  perHitStun: number
  /** 总失衡值 = count × perHitStun */
  totalStun: number
  /** 落在失衡窗口内的单位占比（0-1；失衡轴模式下窗口内失衡值无效） */
  inAxisFraction: number
  /** 落在失衡窗口内的失衡值（无效部分） */
  inAxisStun: number
  /** 有效失衡值 = totalStun - inAxisStun */
  effectiveStun: number
}

/** 队伍失衡池结果 */
export interface StunPoolResult {
  /** 各招式的失衡贡献明细 */
  contributions: StunContribution[]
  /** 全队有效总失衡值（已扣除失衡窗口内的无效失衡值） */
  totalStunBuildUp: number
  /** 全队毛失衡值（未扣除轴内无效部分；无轴时 = totalStunBuildUp） */
  grossStunBuildUp: number
  /** 失衡窗口内失效的失衡值合计 */
  inAxisStunTotal: number
  /** Boss 失衡值上限 */
  bossStunValue: number
  /** 失衡次数 = floor(有效总失衡值 / bossStunValue)；含失衡值返还（第1次满额、之后按 (1-返还比例) 折算） */
  stunCount: number
  /** 失衡值返还比例（0~0.25，雨果决算口径） */
  stunRefundRatio: number
  /** 实际返还的失衡值合计（除最后一次失衡外的每次各返还 refundStunRatio × bossStunValue） */
  stunRefundValue: number
  /** Boss 白送的失衡值（如 亵渎者 30% 失衡上限；计入 stunCount 推导，不参与抗性/返还折算） */
  stunGift: number
  /** 每次失衡的连携次数（首领默认3，可由用户配置） */
  chainCountPerStun: number
  /** 总连携次数 = 失衡次数 × 每次连携次数 */
  chainCountTotal: number
  /** 失衡相关喧响奖励 = 失衡次数 × 20 + 总连携次数 × 10 */
  decibelBonus: number
  /** 各角色的有效失衡贡献汇总 */
  perSlotStun: number[]
}

// ============ 积蓄池 ============

/** 单个元素的积蓄进度 */
export interface AnomalyProgress {
  /** 元素 */
  element: string
  /** 总积蓄值 */
  totalBuildUp: number
  /** 积蓄上限（暂时用默认值，后续由用户配置） */
  buildUpCap: number
  /** 触发异常次数 = floor(总积蓄值 / 积蓄上限) */
  triggerCount: number
  /** 触发异常奖励喧响 = triggerCount × 170 */
  decibelBonus: number
  /** 该元素触发次数按角色归属拆分 */
  perSlotTriggerCounts: number[]
  /** 各招式积蓄贡献明细 */
  contributions: AnomalyContribution[]
}

/** 单个招式的异常积蓄贡献记录 */
export interface AnomalyContribution {
  moveId: string
  moveName: string
  slot: number
  element: string
  count: number
  /** 基础积蓄值（从倍率表 anomaly_buildup row 提取） */
  baseBuildUp: number
  /** 单次实际积蓄值（经过乘区计算后） */
  perHitBuildUp: number
  /** 总积蓄值 */
  totalBuildUp: number
  /** 本行招式限定增伤（%，从 SkillExecution.dmgBonus 携带，进异常基础区增伤按积蓄占比加权） */
  dmgBonus?: number
}

/** 队伍积蓄池结果 */
export interface AnomalyPoolResult {
  /** 各元素的积蓄进度 */
  perElement: AnomalyProgress[]
  /** 触发异常总次数（所有元素之和） */
  totalTriggerCount: number
  /** 紊乱次数 = min(sum - 1, 2 × (sum - max)) */
  disorderCount: number
  /** 积蓄相关喧响奖励 = 触发异常 × 170 + 紊乱 × 85 + 乱流 × 85 */
  decibelBonus: number
  /** 各角色归属的异常触发次数 */
  perSlotAnomalyTriggers: number[]
  /** 各角色归属的紊乱触发次数 */
  perSlotDisorderTriggers: number[]
  /** 各角色归属的乱流触发次数（触发者为风底属性提供者） */
  perSlotTurbulenceTriggers: number[]
  /** 各角色获得的异常/紊乱/乱流喧响奖励（含队友伴随） */
  perSlotBonus: number[]
  /** 异常状态覆盖率分析 */
  coverage: AnomalyCoverageResult
  /** 紊乱伤害详情（无风属性时计算） */
  disorderDamage?: DisorderDamageResult
  /** 乱流伤害详情（有风属性时计算） */
  turbulenceDamage?: TurbulenceDamageResult
  /** 维琳娜风蚀资源明细（有风属性且触发乱流时计算） */
  velinaCorrosionSource?: VelinaCorrosionSource
  /** 标准元素 DOT 伤害明细（灼烧/感电/侵蚀） */
  standardDotDamage?: StandardDotDamageResult
  /** 爱丽丝畏缩 DOT 伤害明细 */
  aliceCoweringDot?: AliceCoweringDotResult
  /** 异常事件明细：把”异常条触发/覆盖触发/动作跟随触发”等事件化展示给开发调试 */
  anomalyEvents: AnomalyEventRecord[]
}

/** 异常事件记录：不是新的伤害公式，只是把当前函数真正算出的事件透明暴露 */
export interface AnomalyEventRecord {
  /** 稳定 id */
  id: string
  /** 事件类型 */
  type: 'anomaly_trigger' | 'disorder' | 'turbulence' | 'special_voidflare' | 'luminize' | 'release' | 'polar_disorder' | 'polar_assault'
  /** 展示名称 */
  label: string
  /** 来源说明：积蓄条、覆盖、动作跟随等 */
  source: string
  /** 事件次数 */
  count: number
  /** 本事件在当前函数中使用的公式 */
  formula: string
  /** 本事件读取的关键字段 */
  fields: string[]
  /** 当前实现限制或归属说明 */
  note?: string
}

// ============ 异常覆盖率 ============

/** 异常状态覆盖率结果 */
export interface AnomalyCoverageResult {
  /** 各元素的总DoT时间（触发次数 × 默认持续时间） */
  perElementDoTTime: Record<string, number>
  /** 全元素总DoT时间 = Σ(触发次数 × 持续时间) */
  totalDoTTime: number
  /** boss无敌时间（用户配置） */
  invincibleTime: number
  /** 有效DoT时间 = 总DoT时间 - boss无敌时间 */
  effectiveDoTTime: number
  /** 总战斗时间 */
  totalTime: number
  /** 综合异常覆盖率 = 有效DoT时间 / 总战斗时间 */
  coverageRate: number
  /** 各元素覆盖率 = 该元素DoT时间 / 总战斗时间 */
  perElementCoverageRate: Record<string, number>
  /** 物理异常（畏缩）覆盖率，用于增幅失衡 */
  physicalCoverageRate: number
  /** 霜寒（冻结+烈霜）覆盖率，用于敌人受到暴击伤害提升 */
  frostCoverageRate: number
  /** 风化实际覆盖率：非风异常只在 (1 - windCoverageRate) 的时间窗内正常生效，其余走乱流 */
  windCoverageRate: number
}

// ============ 紊乱伤害 ============

/** 紊乱倍率公式参数 */
export interface DisorderFormula {
  /** 基础倍率（百分比） */
  baseMultiplier: number
  /** 每tick时间系数（百分比） */
  tickMultiplier: number
  /** tick间隔（秒），用于 floor(T/interval) */
  tickInterval: number
}

/** 单次紊乱伤害详情 */
export interface DisorderDamageDetail {
  /** 被覆盖的异常元素 */
  element: string
  /** 异常施加者 slot */
  applierSlot: number
  /** 触发者 slot */
  triggerSlot: number
  /** 剩余时间 T（秒） */
  remainingTime: number
  /** 紊乱倍率（百分比） */
  disorderMultiplier: number
  /** 异常质量（基础部分：atk × 倍率 × 增伤 × 精通 × 防御[穿透] × 等级） */
  anomalyMass: number
  /** 结算区乘数（减防 × 减抗 × 异常增伤 × 暴击 × 易伤 × 失衡） */
  settlementMultiplier: number
  /** 该元素对应的紊乱事件次数 */
  events: number
  /** 单次紊乱伤害 */
  perEventDamage: number
  /** 最终紊乱伤害（该元素所有紊乱事件合计） */
  damage: number
}

/** 紊乱伤害汇总 */
export interface DisorderDamageResult {
  /** 各次紊乱伤害明细 */
  details: DisorderDamageDetail[]
  /** 总紊乱伤害 */
  totalDamage: number
  /** 紊乱次数 */
  count: number
  /** 平均单次紊乱伤害 */
  avgDamage: number
}

// ============ 爱丽丝畏缩 DOT ============

/** 爱丽丝畏缩 DOT 伤害结果 */
/** 标准元素 DOT 伤害明细（灼烧/感电/侵蚀） */
export interface StandardDotDamageResult {
  /** 各元素 DOT 详情 */
  details: StandardDotDamageDetail[]
  /** 总 DOT 伤害 */
  totalDamage: number
}

export interface StandardDotDamageDetail {
  element: string
  applierSlot: number
  /** 每 tick 倍率（%） */
  tickMultiplier: number
  /** tick 间隔（秒） */
  tickInterval: number
  /** 总 tick 数（按有效时间折算） */
  totalTicks: number
  /** 单 tick 伤害 */
  perTickDamage: number
  /** 总伤害 */
  damage: number
}

export interface AliceCoweringDotResult {
  /** DOT tick 间隔（秒） */
  dotInterval: number
  /** DOT 每 tick 比例（% 强击伤害） */
  dotRatio: number
  /** 强击（物理异常）单次基础伤害 */
  assaultDamagePerTrigger: number
  /** DOT 每 tick 伤害 = assaultDamage × dotRatio% */
  dotDamagePerTick: number
  /** 畏缩 DOT 总 tick 数 = 物理异常覆盖时间 / dotInterval */
  totalTicks: number
  /** 畏缩 DOT 总伤害 = perTick × totalTicks */
  totalDotDamage: number
}

// ============ 乱流伤害 ============

/** 乱流倍率公式参数 */
export interface TurbulenceFormula {
  /** 基础倍率（百分比） */
  baseMultiplier: number
  /** 每tick时间系数（百分比） */
  tickMultiplier: number
  /** tick间隔（秒） */
  tickInterval: number
}

/** 单次乱流伤害详情 */
export interface TurbulenceDamageDetail {
  /** 非风异常元素 */
  element: string
  /** 非风异常施加者 slot */
  applierSlot: number
  /** 本明细包含的乱流事件次数 */
  count: number
  /** 其中吃到风蚀强化的次数 */
  boostedCount?: number
  /** 剩余时间 T（秒） */
  remainingTime: number
  /** 乱流倍率（百分比） */
  turbulenceMultiplier: number
  /** 异常质量（基础部分，来自非风角色） */
  anomalyMass: number
  /** 结算区乘数（维琳娜为触发者） */
  settlementMultiplier: number
  /** 最终乱流伤害 */
  damage: number
}

/** 乱流伤害汇总 */
export interface TurbulenceDamageResult {
  /** 各次乱流伤害明细 */
  details: TurbulenceDamageDetail[]
  /** 总乱流伤害 */
  totalDamage: number
  /** 乱流次数 */
  count: number
  /** 其中吃到风蚀+150%倍率区提升的次数 */
  boostedCount: number
  /** 平均单次乱流伤害 */
  avgDamage: number
}

// ============ 失衡轴 ============

/** 轴内单个动作定义 */
export interface StunAxisAction {
  /** 角色槽位 0/1/2 */
  slot: number
  /** 倍率表 moveId（如 '1401010'）或 'basic'（basic 单位=秒，其余单位=次） */
  moveId: string
  /** 单次轴执行该动作的次数（basic 为秒数） */
  count: number
  /** 自定义显示名（可选，默认从倍率表取） */
  label?: string
  /** 动作开始时间（秒，相对失衡窗口起点）。默认 0，用户拖拽定位。 */
  startTime?: number
  /** 转大变体：仅队友赠送大招块用。'60'=60转大（耗1连携窗口）、'90'=90转大（不耗连携）。缺省=普通大招。 */
  promoteVariant?: '60' | '90'
  /** 来源标记：'gift' = 诺姆膛温换连携（赠送连携，不占目标自身连携次数，吃易伤由块标记）。缺省=普通动作。 */
  sourceTag?: 'gift'
  /** 动作单次时长覆盖（秒）：覆盖倍率表 actionTime。仪玄轴内凝云术专用（蓄力 0-2s 可延长/缩短）。 */
  duration?: number
  // 注：失衡易伤覆盖比例由 startTime + 动作时长 + 窗口时长推导（core/stunAxis.computeInAxisRatio），不在此存储。
}

/** 单轮轴定义 */
export interface StunAxis {
  /** 轴名（如 "轴1"） */
  name: string
  /** 该轴打几次失衡窗口；缺省 = 兜底（吃掉所有剩余窗口）。多条轴时按顺序分配，末条兜底。 */
  count?: number
  /** 轴内动作列表 */
  actions: StunAxisAction[]
  /** 兜底平A角色槽位：资源不足时剩余窗口时间由该角色打平A填充（吃易伤）；缺省不填充 */
  basicFillerSlot?: number
  /**
   * 进窗初始异常状态（BOSS_ENTRY_ANOMALY_OPTIONS 索引，0/缺省=未指定）。
   * 中间态口径（2026-08-24 用户纠正）：每次失衡都是中间态——该声明表示敌方以什么异常状态
   * 进入这段失衡，在该条目首个窗口边界注入状态机（不记紊乱）。随预设导出保留。
   */
  entryAnomaly?: number
  /**
   * 进窗时各元素异常条的进度（key=基础元素，value=第一管百分比 0-100）。**可同时填多个**：
   * 多个角色各攒各的条，两条都接近满时进窗一碰即连续触发打紊乱。随预设导出保留。
   */
  entryBars?: Record<string, number>
  /**
   * 被抑制的异常触发事件 id（`${条目内局部窗序}:${基础元素}:${序数}`）。
   * 满槽保持不触发（施加者后台/CD 无法结算由用户自行判断），编辑器可恢复。随预设导出保留。
   */
  suppressedTriggers?: string[]
}

/** 轴方案命中条件（全部满足才命中） */
export interface StunAxisCondition {
  /** 失衡次数下限（含） */
  stunMin?: number
  /** 失衡次数上限（含） */
  stunMax?: number
  /** 好评（摇人值）下限（含） */
  goodReviewMin?: number
  /** 好评（摇人值）上限（含） */
  goodReviewMax?: number
  /** 闪能（强化特殊技能量）下限（含）；检查 energySlot 指定槽位的总闪能 */
  energyMin?: number
  /** 闪能（强化特殊技能量）上限（含） */
  energyMax?: number
  /** 能量检查的槽位（默认 0 = 主C） */
  energySlot?: number
  /** 命座（影画）下限（含）；检查 cinemaSlot 指定槽位的命座等级 */
  cinemaMin?: number
  /** 命座（影画）上限（含） */
  cinemaMax?: number
  /** 命座检查的槽位（默认 0 = 主C） */
  cinemaSlot?: number
}

/** 窗口自动分配算法名（读取时按此名匹配，不按预设名；新轴文件声明此字段即可复用同一算法） */
export type StunAxisSplitAlgorithm = 'goodReviewOverflow' | 'energyOverflow'

/** 窗口自动分配方案：先全给 base 轴，资源溢出再逐窗升级成 upgrade 轴（鸡兔同笼） */
export interface StunAxisWindowSplit {
  /** 算法名 */
  algorithm: StunAxisSplitAlgorithm
  /** 兜底轴：先全打这个 */
  baseAxis: StunAxis
  /** 升级轴：资源溢出时逐窗升级成这个 */
  upgradeAxis: StunAxis
  /** 兜底轴每窗资源消耗（goodReviewOverflow 缺省自动按 promoteVariant 求和：60转大=60、90转大=90） */
  baseCost?: number
  /** 升级轴每窗资源消耗 */
  upgradeCost?: number
  /** energyOverflow 检查的闪能槽位（默认 0 = 主C） */
  energySlot?: number
}

/** 条件轴方案：一组轴 + 命中条件；解析按顺序取第一个命中项，最后一条建议无条件兜底 */
export interface StunAxisPlan {
  name: string
  /** 命中条件；缺省 = 无条件兜底 */
  when?: StunAxisCondition
  /** 固定轴（与 split 二选一） */
  axes?: StunAxis[]
  /** 按算法名自动分配窗口（与 axes 二选一）；读取时按 split.algorithm 分发 */
  split?: StunAxisWindowSplit
}

/** 轴内单个 (slot, moveId) 的取用分配结果 */
export interface StunAxisAllocation {
  slot: number
  moveId: string
  /** 轴内单位数（次或秒，跨边界按比例折算，可为小数） */
  inAxisUnits: number
  /** 轴外单位数（次或秒） */
  outAxisUnits: number
}

/** 失衡轴计算结果 */
export interface StunAxisResult {
  /** 所有轴内失衡值之和（信息展示：捏轴动作本身产生的失衡值） */
  totalInAxisStun: number
  /** 失衡次数（固定，来自失衡池收敛结果；捏轴不改变它） */
  stunCount: number
  /** 轴总轮数 = Σ axisDetails.times（解析自 axis.count，末条缺省兜底） */
  totalAxisRounds: number
  /** 易伤覆盖率 = 失衡次数 × 窗口时长 / 有效时间（与捏轴无关，固定） */
  stunCoverage: number
  /** 每个 (slot, moveId) 的轴内/轴外取用分配，供伤害池拆分直伤 */
  allocation: Record<string, StunAxisAllocation>
  /** 每轴明细 */
  axisDetails: {
    name: string
    times: number
    axisStun: number
    /** 该轴单轮动作块总时长（秒） */
    axisDuration: number
    actions: {
      actionKey: string
      count: number
      /** 该动作块在窗口内的覆盖比例（0-1，跨边界折算） */
      inAxisRatio: number
      perStun: number
      totalStun: number
      overuse: number
    }[]
    warnings: string[]
  }[]
  /** 全局警告（资源超额 / 窗口数超限） */
  globalWarnings: string[]
}

