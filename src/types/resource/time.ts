/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：时间分配 / 迭代中间状态
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { EnergySource } from './energy'

// ============ 时间分配 ============

/** 单个角色的战场时间分配 */
export interface TimeAllocation {
  /** 单角色前台时间（必做动作前台 + 平A时间，含合轴部分） */
  frontlineTime: number
  /** 后台时间（180 - 前台时间） */
  backstageTime: number
  /** 合轴时间（前台中的非操作时间，触发"非操作中角色"回能加成） */
  comboAlignTime: number
  /**
   * 合轴抵扣时间：comboAlignTime 中**含在 necessaryTime 内**、可与其他角色动作并行
   * 的部分——团队时间预算与超时判定只抵扣该值（NET 约定模块的合轴已剔除出
   * necessaryTime，不再重复抵扣；GROSS 约定与通用招式 = comboAlignTime）。
   */
  comboAlignCredit?: number
  /** 平A时间（可自由分配的战场时间） */
  basicAttackTime: number
  /**
   * 动态合轴吸收（秒；债 2 R37-J5 v2，用户口径 2026-09-19）：Σ净必要 > 预算时，非操作角色（操作角色 = 净必要最大的槽）
   * 的前台按溢出量被合轴吸收的部分——已计入 comboAlignCredit。0/undefined = 本轮没发生吸收。
   */
  dynamicComboAlignSeconds?: number
  /** 必做动作前台时间（强特+大招+连携+特殊招式的 actionTime 之和，未扣除合轴） */
  necessaryTime: number
}

// ============ 迭代中间状态 ============

/** 单次迭代中各角色的中间状态 */
/**
 * 平A池权重·分配策略**三态**（用户 2026-09-10 裁决：默认 B、开关给出更慢的 C；再补一档"全关"）。
 *  · `'static'`   = 不自动分配（静态默认权重 / 手填值）——难度曲线「全关」档的落点，也把手填自由度还回来
 *  · `'balanced'` = 边际均衡（B，≈3 倍求值）——**默认**
 *  · `'joint'`    = 多杠杆联合（C，更慢，均衡 + 弹刀阶梯 ≈15~20 次求值）
 */
export type TimeWeightMode = 'static' | 'balanced' | 'joint'

/**
 * 失衡计划值（外层不动点实数）→ **计数** 的投影方式（见 `ResourceCalcConfig.stunPlanProjection`）。
 * `'off'` = 现行口径（实数直接当次数用）；其余把「离散动作的次数」投影成整数，时间账保持实数。
 */
export type StunPlanProjection = 'off' | 'floor' | 'round' | 'ceil' | 'physical'

export interface IterationState {
  /** 平A时间 */
  basicAttackTime: number
  /** 强特次数 */
  exSpecialCount: number
  /** 终结技次数 */
  ultimateCount: number
  /** 本轮计划连携次数；先按配置参与资源池迭代，后续可由失衡池二阶段回填 */
  chainCountTotal: number
  /** 总能量 */
  totalEnergy: number
  /** 驱动本次迭代次数的能量源快照（2026-09-03：展示与驱动同源——装配直接复用，
   *  杜绝「iterate 用上轮态 vs 装配用当前态」的 Δ 分裂；缺省 = 重新计算） */
  energySource?: EnergySource
  /** 总喧响（含开局赠送） */
  totalDecibel: number
  /** 必做动作前台时间（未扣除合轴） */
  necessaryTime: number
  /**
   * 团队封顶（`feasibleScale < 1`）**之前**的账本份额 = 吸收后净必要 + 合轴抵扣（秒）。
   *
   * **为什么存在**（2026-10-06，1431 折叠残差专项）：折叠环的 `excess = rowTime − 账本` 必须对
   * **封顶前**的账本收敛，否则与封顶构成正反馈——`iterate` 令 `necessary = (rowTime + acc) × scale`
   * 且 `scale = budget / Σ(rowTime + acc)` ⇒ `acc ↑ ⇒ scale ↓ ⇒ necessary ↓ ⇒ excess ↑ ⇒ acc ↑`。
   * 实测 `auto-1431-1481-1491`：`acc` 62.57s（战斗总时长才 180s），账本被压到 135.02、
   * 物化行 149.40 ⇒ 那 14.38s「excess」其实是**封顶砍掉的秒数**，不是欠账。
   * `accLeverLost` 出口只冻结当轮增量、不撤销已累进的历史量，拦不住这条环。
   *
   * 只在封顶激活时写入；缺省 `undefined` ⇒ 折叠环回落 `necessaryTime`，默认路径逐位不变。
   */
  necessaryUncappedTime?: number
  /** 前台时间 */
  frontlineTime: number
  /** 后台时间 */
  backstageTime: number
  /** 合轴时间 */
  comboAlignTime: number
  /** 合轴抵扣时间（comboAlignTime 中含在 necessaryTime 内、计入团队时间预算抵扣的部分；缺省 = 0） */
  comboAlignCredit?: number
  /** 动态合轴吸收秒数（见 IterationState.dynamicComboAlignSeconds；已含在 comboAlignCredit 内） */
  dynamicComboAlignSeconds?: number
}
