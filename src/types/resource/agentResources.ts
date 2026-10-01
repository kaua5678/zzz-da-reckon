/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：单角色资源汇总与角色专属资源（维琳娜 / 爱丽丝等）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { DecibelSource, EnergySource } from './energy'
import type { AnomalyEventExecution, SkillExecution } from './execution'
import type { TimeAllocation } from './time'

// ============ 维琳娜专属资源 ============

/** 维琳娜风蚀资源明细 */
export interface CorrosionSource {
  /** 乱流总次数 */
  turbulenceCount: number
  /** 0/1风蚀触发乱流时获得风蚀并触发微域气旋的次数 */
  microCycloneCount: number
  /** 2风蚀触发乱流时消耗风蚀并替换为广域气旋的次数 */
  broadCycloneCount: number
  /** 本次乱流获得+150%倍率区提升的次数 */
  boostedTurbulenceCount: number
  /** 2命风化获得风蚀的期望值 */
  c2WindGainExpected: number
  /** 6命消耗2风蚀后返还1点的次数 */
  cinema6RefundCount: number
  /** 最终剩余风蚀 */
  finalCorrosion: number
  /** 当前状态机说明 */
  note: string
}

// ============ 爱丽丝专属资源 ============

/** 柏妮思燃点/余烬资源明细 */
export interface BurniceMechanicSource {
  initialIgnition: number
  ignitionFromEnergy: number
  ultimateIgnitionGain: number
  totalIgnition: number
  ignitionCap: number
  specialStateActive: boolean
  emberTriggerCount: number
  emberCost: number
  emberDamageRatio: number
  emberDamageRatioWithMastery: number
  emberDamagePerHit: number
  emberTotalDamage: number
  /** 单次基础积蓄，固定 60；1命效率加成单独存在 emberBuildUpEfficiencyBonusPct */
  emberBuildUpPerHit: number
  emberBuildUpEfficiencyBonusPct: number
  /** 基础积蓄总和 = 60 × 触发次数，不含1命效率加成 */
  emberTotalBuildUp: number
  emberTotalTriggerCount: number
  stirringMaxCount: number
  stirringCount: number
  stirringDamageRatio: number
  /** 搅拌式（炽焰搅拌式 1171007 融合）单次动作时长（秒） */
  stirringActionTimeSeconds: number
  stirringIgnitionCost: number
  stirringIgnitionSpent: number
  stirringFreeEmberCount: number
  flowCountRaw: number
  flowCountUtilization: number
  flowCountEffective: number
  flowFireCount: number
  tossingCount: number
  tossingMoveId: string
  tossingDamageRatio: number
  /** 流火·灼热抛接法（1171026）单次动作时长（秒） */
  tossingActionTimeSeconds: number
  releaseMultiplier: number
  releaseCount: number
  cinemaLevel: number
  cinema2TeamPenRatio: number
  cinema4CritRateBonus: number
  cinema4DoubleSprayMaxSeconds: number
  cinema6FireResIgnore: number
  cinema6SpecialEmberCount: number
  cinema6SpecialEmberPerCast: number
  cinema6SpecialEmberBaseRatio: number
  cinema6SpecialEmberDamageRatio: number
  cinema6SpecialEmberDamagePerHit: number
  cinema6SpecialEmberTotalDamage: number
  cinema6BurnBurstCount: number
  cinema6BurnBurstMultiplier: number
  cinema6BurnBurstDamageRatio: number
  potentialAnomalyMasteryBonus: number
  potentialDmgBonus: number
  emberCooldownSeconds: number
  singleCastCount: number
  doubleCastCount: number
  singleSpraySeconds: number
  doubleSpraySeconds: number
  singleCastEnergy: number
  doubleCastEnergy: number
  singleCastTime: number
  doubleCastTime: number
  totalExEnergy: number
  totalExTime: number
  singleSustainedMultiplier: number
  singleExplosionMultiplier: number
  doubleSustainedMultiplier: number
  doubleExplosionMultiplier: number
  note: string
}

// ============ 角色资源汇总 ============

/** 般岳·艾洛温嗔火/怒相循环明细（用户确认口径） */
export interface BanyueRageCycle {
  /** 怒相次数 = floor(嗔火总量 / 120) */
  rageCount: number
  /** 嗔火总量 = 115(开局) + (闪反+招架+金身)×4 + 怒相外闪能消耗×0.5 */
  furyTotal: number
  /** 怒相外连段总数（论道连段 + 地动山摇连段，闪能支付 60/组，自动 = floor(剩余闪能/60)） */
  comboOutCount: number
  /** 怒相外「地动→山摇·怒」连段组数（滑块分配，默认 0 = 全打论道连段） */
  diDongComboCount: number
  /** 失衡轴内捏的普通强特消耗的总闪能（默认 0，轴模式由捏轴反馈；连段块免费不计） */
  axisExSpend: number
  /** 失衡轴内捏的连段块总数（免费·山威 = 怒相内连段的轴内表达，不影响怒相外自动连段） */
  axisComboCount: number
  /** 双反次数（完美闪避+金身弹刀组合，+10嗔火/次，产冲霄） */
  dualCounterCount: number
  /** 怒相内「地动→山摇·怒」连段组数（轴内捏的 banyue-combo-didong 块决定，默认 0 = 怒相内全打论道连段） */
  rageDiDongComboCount: number
  /** 怒相内论道次数（山威免费，= (2×怒相次数 − rageDiDongComboCount)） */
  lunDaoRageCount: number
  /** 怒相内狮子吼·怒次数（山威免费，论道派生连段，= lunDaoRageCount） */
  shiZiHouNuCount: number
  /** 怒相内地动次数（山威免费，地动山摇连段 = rageDiDongComboCount） */
  diDongRageCount: number
  /** 怒相内山摇·怒次数（山威免费，地动派生连段 = rageDiDongComboCount） */
  shanYaoNuRageCount: number
  /** 怒相外论道连段的论道次数（= comboOutCount − diDongComboCount） */
  lunDaoOutCount: number
  /** 怒相外论道连段的狮子吼·怒次数（= comboOutCount − diDongComboCount） */
  shiZiHouNuOutCount: number
  /** 怒相外地动山摇连段的地动次数（= diDongComboCount） */
  diDongOutCount: number
  /** 怒相外地动山摇连段的山摇·怒次数（= diDongComboCount） */
  shanYaoNuOutCount: number
  /** 怒相内山摇次数（剩余山威，固定 0） */
  shanYaoRageCount: number
  /** 闪能总收入（秒回+进场+山威回能） */
  flashIncome: number
  /** 闪能总支出（怒相外连段+轴内普通强特） */
  flashSpent: number
  /** 山威免费强特总数 = 怒相次数 × 4 */
  swayExCount: number
  /** 嘲讽取消次数（钳制到失衡外连段总数） */
  tauntCancelCount: number
  /** 失衡外连段组数（轴模式 = 全部连段 − 轴内捏块；非轴模式 = 怒相外自动连段，怒相内默认失衡内全取消） */
  outStunComboCount: number
  /** 失衡轴内捏的连段块总数（banyue-combo + banyue-combo-didong，×窗口数；非轴模式 0） */
  axisInComboCount: number
  /** 失衡外连段末尾强特后摇次数（= outStunComboCount − 嘲讽取消；失衡内连段被连携/大招/瞬拳取消后摇，不计） */
  comboOutRecoveryCount: number
  /** 后摇按两类连段占比拆分：论道连段剩余后摇次数（末尾 = 狮子吼·怒） */
  lunDaoRecoveryCount: number
  /** 后摇按两类连段占比拆分：地动山摇连段剩余后摇次数（末尾 = 山摇·怒） */
  diDongRecoveryCount: number
}

/** 单个角色的资源池计算结果 */
export interface CharacterResourceResult {
  /** 槽位 0/1/2 */
  slot: number
  /** 角色 ID */
  agentId: string
  /** 角色名称 */
  agentName: string
  /** 是否命破角色（使用闪能而非能量） */
  isFlashUser: boolean

  // --- 时间 ---
  timeAllocation: TimeAllocation

  // --- 能量 ---
  energySource: EnergySource
  /**
   * 真正驱动 exSpecialCount 的收敛后总能量（= 收敛末轮 iterate 的 totalEnergy）。
   *
   * 与 `energySource.total` 应当一致：iterate 与最终装配用同一函数、同一入参（连携次数
   * 同口径）。历史版本 iterate 内 calcEnergySource 以 chainCountTotal=0 调用，时光切片
   * 连携触发的回能只进展示明细、不参与次数推导，二者存在固定差值——已修复对齐。
   * 保留双字段的目的：让口径分裂可被测试/界面观测（差值 ≠ 0 即回归信号）。
   */
  derivedEnergy: number
  /** 可用强特次数 = 总能量 ÷ 强特消耗 */
  exSpecialCount: number
  /** 强特 move id */
  exSpecialMoveId: string
  /** 强特单次能量消耗 */
  exSpecialEnergyConsume: number

  // --- 喧响 ---
  decibelSource: DecibelSource
  /** 终结技消耗（默认3000，部分角色2000） */
  ultimateCost: number
  /** 可用终结技次数 = 总喧响 ÷ 终结技消耗 */
  ultimateCount: number

  // --- 专属资源 ---
  /** 柏妮思机制资源明细 */
  burniceMechanicSource?: BurniceMechanicSource
  /** 般岳嗔火/怒相循环明细 */
  banyueRageCycle?: BanyueRageCycle
  /** 通用 spec 资源计算结果：key = spec resource.id */
  specResources?: Record<string, any>

  // --- 连携 ---
  /** 每次失衡的连携次数（用户可调） */
  chainCountPerStun: number
  /** 总连携次数 = 每次失衡连携次数 × 失衡次数 */
  chainCountTotal: number

  // --- 招式执行计划 ---
  executions: SkillExecution[]
  /** 异常事件执行计划：特殊虚耀/异放/极性紊乱等事件单独展示 */
  anomalyEventExecutions: AnomalyEventExecution[]

  // --- 失衡（该角色造成的总失衡值，后续模块用） ---
  totalStunBuildUp: number
}

/** 特殊动作喧响奖励结果 */
export interface SpecialActionBonusResult {
  /** 弹刀喧响 = parryCount × 215 */
  parry: number
  /** 连携喧响 = chainCount × 10 */
  chain: number
  /** 闪避反击喧响 = dodgeCounterCount × 10 */
  dodgeCounter: number
  /** 快速支援喧响 = quickAssistCount × 20 */
  quickAssist: number
  /** 总计（仅完整奖励，不含伴随重复获得） */
  total: number
  /** 各角色弹刀次数 */
  perSlotParry: number[]
  /** 各角色连携次数 */
  perSlotChain: number[]
  /** 各角色闪避反击次数 */
  perSlotDodgeCounter: number[]
  /** 各角色快速支援次数 */
  perSlotQuickAssist: number[]
  /** 各角色获得的特殊动作喧响（含伴随） */
  perSlotBonus: number[]
}
