/**
 * 资源池计算引擎
 *
 * 核心循环：平A时间→回能→强特/大招次数→必做动作前台时间→可分配时间→重新分配
 * 资源系统：能量/闪能、喧响、时间、失衡、连携
 *
 * 设计要点：
 * - 不关注资源上限溢出，只算总回复量→可用次数
 * - 喧响伴随获得：先算每人独立获得，最后把可分享部分分给队友
 * - 命破角色用闪能替代能量，逻辑相同
 */
import type {
  ResourceCalcConfig, CharacterOperationConfig,
  EnergySource, IterationState,
} from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { crossAgentSupplyAt, findCrossAgentSupplySlots, ultimateGiftOf, giftDecibelForCfg } from './crossAgentSupply'
import { curtainInfoOf } from './curtain'
import { DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { stunCountForCountChannel } from '@/core/stunPlanProjection'

/**
 * 计数通道用的失衡次数（C7 投影；`globalCfg.stunPlanProjection='off'` 时**恒等** ⇒ 0 delta）。
 * 只替换「把计划值当次数乘」的地方（连携/喧响/能量）；时间账与不动点迭代继续读实数 `globalCfg.stunCount`。
 * 见 `core/stunPlanProjection.ts`。
 */
function countStunOf(globalCfg: ResourceCalcConfig): number {
  return stunCountForCountChannel(globalCfg)
}

import { calcCrossAgentEnergy } from './crossAgentEnergy'
import { calcEnergySource, calcRawDecibelParts } from './resourceIncome'
import {
  decibelEfficiencyMultiplier,
  extraNecessaryActionOf,
  exSpecialNecessaryTime,
  exSpecialComboAlignTime,
  exSpecialComboAlignCredit,
} from './rowAccounting'
import { axisOverlapBySlot } from './timeOccupation'
import { withFeasibleRowsMemo } from './rowBuild'
import { chainCountTotalOf } from '@/core/chainCount'

// ============ 单次迭代 ============

/**
 * 计算强特次数。
 * 连续强特通道：失衡内强特由失衡轴连段反推（exReservedCount），
 * 剩下闪能打非失衡强特（每次 50 闪能，回 15，净耗 35 由 refund 循环收敛）。
 */
export function resolveExSpecialCount(cfg: CharacterOperationConfig, totalEnergy: number): number {
  // 替代资源型强特（如克拉蕾锐能 60/发）：次数由模块资源账本给出（不动点，上一轮写入），
  // 不由能量预算推导、不扣能量——2026-09 成本类型化（findExSpecial costType=resource）。
  if (cfg.exSpecialCostType === 'resource') {
    return Math.max(0, Math.floor(cfg.exSpecialResourcePaidCount ?? 0))
      + Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
  }
  if (cfg.exSpecialEnergyConsume <= 0) return 0
  // 般岳：强特总次数由嗔火/怒相循环决定（怒相内山威免费 + 怒相外付费连段 + 地动滑块 + 轴内捏的
  // 普通强特），不能用 闪能/20 —— 免费强特不耗闪能；轴内连段块不重复计（认领怒相内/外行，池守恒）。
  // 2026-09-24 CC-6a：角色数学迁进 banyue 模块的能力声明，引擎按能力查询（规则 6），
  // 返回 undefined = 本模块不认领 ⇒ 回落通用公式。
  const fromModule = getAgentMechanic(cfg.agentId)?.exSpecialCount?.({ cfg, totalEnergy })
  if (fromModule !== undefined) return fromModule
  // debt: 全局实数化收敛重构（正反馈模块统一连续通道 + 逐模块重校准）——连续强特
  // 通道（解析不动点 + 阻尼实数迭代 + 终局整数重推）；全局「实数化松弛、终局才 floor」会重排所有
  // 带时间/资源循环模块的均衡（sigrid 出枪式消失前例），需专项按模块重校准。
  // ⚠ 本标记（1a）**保留**：R24 批 1-3 只销掉同名的 1b（可行性封顶处那条，其量化依据
  //   「落点随初值差 ±1 次强特」已被三条独立实测证伪）。批 1-1 已由 CC-13 落地——通道已是
  //   声明式通用字段（exContinuous/exFinalize/exRefundPerPaid/exReserved*/exRefundFreeCap），
  //   故「1051 的 refund 自指反馈**只能**按角色开洞」这一前提已证伪。债本体（全局「实数化松弛、
  //   终局才 floor」推广到其它正反馈模块 + 逐模块重校准）仍未做 ⇒ 标记保留（规则 16③）。
  // @fact yidhari:refund不动点 口径: 极寒重碾非失衡每发回15闪能属自指反馈——迭代期强特次数实数化（refund解析求解+必要时间信道阻尼）唯一连续不动点，floor只在终局整数重推发生一次（不在迭代中途截断资源循环）；曾致19/20双稳态（种子相关，parry4/dodge10、parry8/dodge2复现），勿改回「迭代期回读整数次数+floor」 | 据 用户@2026-09-04·复核@2026-09-08·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/composables/__tests__/yidhariInteractionGrid.test.ts | 锚 src/core/resource/helpers.ts#resolveExSpecialCount | 信 确认
  // CC-330：「付费/非失衡次数是否保留小数」与「失衡内保留次数（exReservedCount）拆分」正交归一：
  //  · 小数判据：连续强特通道（exContinuous && exRefundPerPaid > 0）在非终局（!exFinalize）保留实数，
  //    其余通道按 exSpecialCountFractional（持续型强特期望值模型，CC-324）决定是否保留实数；
  //  · 失衡内保留拆分（exReservedCount !== undefined）：先扣失衡内成本，剩余闪能按同一小数判据求非失衡次数。
  const consume = cfg.exSpecialEnergyConsume
  const continuous = cfg.exContinuous === true && (cfg.exRefundPerPaid ?? 0) > 0
  const fractional = continuous ? cfg.exFinalize !== true : Boolean(cfg.exSpecialCountFractional)
  if (cfg.exReservedCount !== undefined) {
    const inStun = cfg.exReservedCount
    const inStunCost = cfg.exReservedEnergyCost ?? inStun * consume
    const remaining = totalEnergy - inStunCost
    const outStun = remaining > 0
      ? (fractional ? remaining / consume : Math.floor(remaining / consume))
      : 0
    return inStun + outStun
  }
  const paid = fractional ? totalEnergy / consume : Math.floor(totalEnergy / consume)
  // 免费强特（如南宫羽每次失衡一次免能E）：不占闪能预算，照常计次/计时/喧响
  return paid + Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
}

/**
 * 动态合轴吸收子问题的**旧求解器**（8 轮小不动点迭代）：`docs/mcp-time-allocation-algorithms.md` §5 批 1 的
 * **单点回退**，现只作闭式解在浮点极端参数下判别式舍入为负时的兜底（生产 97 队实测不触发，`disc<0` 数学上不可达——
 * `disc ≥ 4(1−r)·rB·(S−T) ≥ 0`，因 `S ≥ T` 恒成立）。
 *
 * 语义（`S` = Σ净必要、`B` = 预算、`T` = 可吸收总量）：`take = min(Δ, g·T)`、`s = B/(S − take)`、`g ← r·s/(1−r+r·s)`。
 * ⚠ 与闭式解的差别 = 它**可能不收敛**：`|gNext − g| < 1e-9` 的 break 在慢收敛队上第 8 轮仍未触发（T117 §1.6 实测
 * `auto-1431-1481-1491 @ r=0.4`：第 8 轮 `take` 仍在动），此时返回的是**未收敛的近似**，与闭式解差 ~8e-8s。
 * 保留它而不是直接 `take = Δ` 兜底：判别式舍入为负时闭式不可用，而 `Δ` 会**系统性偏大**吸收量（T117 §6 否决记录 2）。
 */
export function legacyComboAlignTake(S: number, B: number, T: number, r: number): number {
  let g = r
  let take = 0
  for (let it = 0; it < 8; it++) {
    take = Math.min(S - B, g * T)
    const remain = S - take
    const s = remain > B ? B / remain : 1
    const gNext = r * s / (1 - r + r * s)
    if (Math.abs(gNext - g) < 1e-9) break
    g = gNext
  }
  return take
}

/** 吸收子问题求解器的分支（= 控制流锁的判别量；见 `solveComboAlignTake`） */
export type ComboAlignBranch = 'cap-not-binding' | 'r1-linear' | 'closed-form' | 'legacy-fallback'

/** `solveComboAlignTake` 的解：`take` = 吸收量；`branch`/`iterations`/`converged` = 诊断 + 锁用 */
export interface ComboAlignSolution {
  take: number
  branch: ComboAlignBranch
  /** 实际迭代轮数：闭式三个分支恒 1，legacy 兜底 1..8（**不是**「跑到残差达标的轮数」） */
  iterations: number
  /** 该解是否停在吸收子问题的不动点上（残差判据，见 `comboAlignTakeResidual`） */
  converged: boolean
}

/**
 * 吸收子问题的**残差**（T119 §④ 口径，T123b 批 2 提为导出函数当收敛判据）。
 *
 * 为什么判据定义在 `take` 上而不是 `g` 上：迭代式是 `take = min(Δ, F(take/T)·T)`，`Δ` 支是**饱和钳**——
 * `g = Δ/T` 不是 `F` 的不动点，但 `take` 已停住（`F(Δ/T)·T = r·T ≥ Δ`）。故「这一步还会不会动」的
 * 正确度量是 `|take − min(Δ, F(take/T)·T)|`；拿 `|gNext − g|` 当判据会把已停住的饱和解误判成未收敛。
 *
 * **为什么必须与 `legacyComboAlignTake` 自带的 `break` 区分**（T119 §① 实测，别再合并两者）：
 * 旧迭代的 `break` 条件是 `|gNext − g| < 1e-9`，它在生产主队 `auto-1431-1481-1491 @ r=0.4`
 * **第 8 轮恰好触发**，而同一轮 `take` 相对上一轮仍动 7.2e-8s、留下的相对残差 = **2.43e-9**
 * ⇒ 「break 触发了」与「真收敛了」是两件事，本判据取后者。
 *
 * @returns 相对残差（`take ≈ 0` 时退化为绝对残差）；0 = 精确停在不动点
 */
export function comboAlignTakeResidual(S: number, B: number, T: number, r: number, take: number): number {
  const g = T > 0 ? take / T : 0
  const remain = S - Math.min(S - B, g * T)
  const s = remain > B ? B / remain : 1
  const gNext = r * s / (1 - r + r * s)
  return Math.abs(take - Math.min(S - B, gNext * T)) / Math.max(1e-300, Math.abs(take))
}

/**
 * 收敛判据门限（相对残差）。**按实测标定，不是拍的**（T123b，100 万随机样本 × 咬合档）：
 *   · 闭式解三个分支：残差**恒 < 1e-15**（最大 **7.443e-16**，超门 **0** 例）⇒ 本门对闭式解零误报；
 *   · 旧 8 轮迭代（咬合档 680705 例）：**680527 例超门**（99.97%，最大残差 **1.957e-1**）⇒ 本门真能分辨。
 * 取 `1e-12`（闭式实测最差值的 ~1300 倍余量、旧迭代最小残差的 ~1/1000）——**不要收紧到 1e-15**
 * （那离实测最差值只剩 1.3 倍，浮点末位抖动会假红），**也不要放宽到 1e-9**（会放过主队那 2.43e-9 的旧读数）。
 *
 * @fact engine:动态合轴吸收/收敛判据 口径: 吸收子问题的「收敛」判据取**相对残差** `|take − min(Δ, F(take/T)·T)|/|take| ≤ 1e-12`（**不是**「迭代轮数打满即未收敛」——旧实现的 `break` 在主队第 8 轮恰好触发却留下 2.43e-9 残差，轮数判据会把它误判成已收敛）；闭式解三分支恒 `converged=true`，读数经 cfg 写回并**再暴露到 `TeamResourceResult`**（cfg 面外部读不到，实测 0/97 队）。全库判据 = `converged == false` 队数 == 0（实测 97 队 0 支，闸门开 35 支） | 据 推导@T117（docs/mcp-time-allocation-algorithms.md §3.0）+ 设计稿 §5 批 2 + 实测@T123b（100 万随机样本：闭式最大残差 7.443e-16 / 旧迭代咬合档 99.97% 超门） | 验 src/core/__tests__/comboAlignClosedForm.test.ts | 锚 src/core/resource/helpers.ts#comboAlignTakeResidual | 信 高
 * ⟳复核: 吸收上限口径（「上限按封顶后终态算」）或求解器分支表再动时，复核「闸门开队数 ≥ 30」与「converged==false 队数 == 0」两条实测读数，并按需重标定 1e-12 门 | 到期 2027-04-30
 */
export const COMBO_ALIGN_CONVERGED_TOLERANCE = 1e-12

/**
 * 动态合轴吸收子问题的**唯一求解器**（T119 批 1 / `docs/mcp-time-allocation-algorithms.md` §3.0 候选 A）。
 *
 * 输入：`S` = Σ净必要、`B` = 预算（预算 = 战斗时间 − 无敌）、`T` = 可吸收总量（Σ非操作角色净必要）、`r` = 吸收上限比例。
 * 语义：`take = min(Δ, g·T)`（`Δ = S − B` 为溢出），容量咬合时 `g` 解不动点方程
 * `T(1−r)·g² − [(1−r)S + rB]·g + rB = 0` 的小根。
 *
 * **为什么抽成导出函数**（T119）：闭式解与旧的 8 轮迭代在**生产读数上逐位差 ≤ 8e-8s**（浮点量级）⇒
 * 数值锁写不出来（读数相同）。按 T116 先例，锁**控制流** = `branch` + `iterations`——把求解器改回 8 轮迭代，
 * `branch` 当场从 `'closed-form'` 变 `'legacy-fallback'`/`'cap-not-binding'`、`iterations` 从 1 变大 ⇒ 锁红。
 * 支路口径见 `src/core/__tests__/comboAlignClosedForm.test.ts`。
 *
 * `converged`（T123b 批 2）走**残差**判据（`comboAlignTakeResidual`）——它与 `branch`/`iterations` 是
 * **两条独立的锁**：`branch` 锁的是「走了哪条路」，`converged` 锁的是「到了没有」。
 * 把 `legacyComboAlignTake` 的结果伪装成闭式解（branch/iterations 都对）⇒ 本字段仍会红。
 */
export function solveComboAlignTake(S: number, B: number, T: number, r: number): ComboAlignSolution {
  const overflow = S - B
  // 情形 1：容量不咬合（s = 1、g = r）——一轮到位，`take = Δ`，与无上限时的分摊公式逐位一致
  if (overflow <= r * T) {
    return { take: overflow, branch: 'cap-not-binding', iterations: 1, converged: true }
  }
  // r = 1：不动点方程二次项系数为 0（退化成一元一次）⇒ g ≡ 1、`take = min(Δ, T)`（此处 Δ > r·T = T ⇒ take = T）
  if (r >= 1) {
    return { take: Math.min(overflow, T), branch: 'r1-linear', iterations: 1, converged: true }
  }
  const quadA = T * (1 - r)
  const quadP = (1 - r) * S + r * B
  const disc = quadP * quadP - 4 * quadA * r * B
  if (disc < 0) {
    const take = legacyComboAlignTake(S, B, T, r)
    return {
      take, branch: 'legacy-fallback', iterations: 8,
      converged: comboAlignTakeResidual(S, B, T, r, take) <= COMBO_ALIGN_CONVERGED_TOLERANCE,
    }
  }
  // 小根 `g*`：代数上 = (P − √disc)/(2A)，此处用 2C/(P + √disc) 规避相消（见 `iterate` 段头注释）
  return { take: Math.min(T, 2 * r * B / (quadP + Math.sqrt(disc)) * T), branch: 'closed-form', iterations: 1, converged: true }
}

/**
 * 单次迭代：根据当前 state 计算新的 state。
 *
 * **S1（资源账本预解）内的四步顺序不可交换**（2026-09-11 显式化）：
 *   1. 单角色能量/喧响（`calcEnergySource` / `calcRawDecibelParts`，行级 Σ 取 `feasibleRows`）；
 *   2. 队友伴随喧响（分享比例，依赖 Step1 的每槽收入）；
 *   3. 终结技次数（喧响总量 ÷ 消耗，依赖 Step2）；
 *   4. 必做动作前台时间 + 合轴抵扣 + 平A池分配 + **可行性封顶**（`timeFeasibleScale`，依赖 Step3 的次数）。
 * 本函数是纯映射（同输入同输出），相位写入由 `materializeRows` 隔离；它的不动点由 `runInnerLoop` 收敛。
 * 整个函数体跑在 `withFeasibleRowsMemo` 作用域里：同槽能量/喧响两次同参数物化共用一次（口径见其头注释）。
 */
export function iterate(
  configs: CharacterOperationConfig[],
  prevStates: IterationState[],
  globalCfg: ResourceCalcConfig,
): IterationState[] {
  return withFeasibleRowsMemo(() => iterateBody(configs, prevStates, globalCfg))
}

function iterateBody(
  configs: CharacterOperationConfig[],
  prevStates: IterationState[],
  globalCfg: ResourceCalcConfig,
): IterationState[] {
  const totalTime = globalCfg.totalTime
  const newStates: IterationState[] = []

  // Step 1: 计算每个角色的能量和喧响（基于上一轮的时间分配）
  const energies: number[] = []
  const energySnapshots: EnergySource[] = []
  const decibels: number[] = []
  const shareableDecibels: number[] = []

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const prev = prevStates[i]

    // 能量。连携次数与展示口径一致（chainCountTotalOverride ?? chainCountPerStun × stunCount）：
    // 时光切片（音擎 13002）连携触发的回能随此进循环、驱动强特次数。曾传 0 造成
    // 「展示明细含连携回能、次数推导不含」的口径分裂（derivedEnergy < energySource.total），
    // 见 CharacterResourceResult.derivedEnergy 注释。
    const chainCountInput = chainCountTotalOf(cfg, countStunOf(globalCfg))
    // 行级能量/喧响 Σ 需要队友前台秒（与装配层 teammateFrontlineSeconds 同语义：Σ 其他人，迭代期取上一轮值，
    // 收敛后与终局装配一致）
    const teamFrontline = prevStates.reduce((sum, st, k) => (k === i ? sum : sum + st.frontlineTime), 0)
    const energySrc = calcEnergySource(cfg, prev, configs, globalCfg.shieldCount, globalCfg.energyShieldCount, chainCountInput, globalCfg.totalTime, teamFrontline)
    // 队友联动回能（单一事实源，与最终装配同函数）
    const crossAgent = calcCrossAgentEnergy(i, configs, prevStates)
    const totalEnergy = energySrc.total + crossAgent.total
    energies.push(totalEnergy)
    // 快照（2026-09-03）：驱动次数的能量源原样存进 state——装配展示复用同一对象，
    // 杜绝「展示重算（当前态）≠ 驱动（上轮态）Δ≠0」的分裂（实测雅/莱卡恩 Δ=+55.5）。
    energySnapshots.push({
      ...energySrc,
      crossAgent,
      supportUltimateRegen: crossAgent.supportUltimateRegen,
      total: totalEnergy,
    })

    // 强特次数 = 总能量 ÷ 强特消耗（伊德海莉失衡内由轴连段反推，剩余打非失衡强特）
    const exSpecialCount = resolveExSpecialCount(cfg, totalEnergy)

    // 喧响（先算独立可分享部分，效率在接收者获得时统一乘入）。
    // 连携数据行回复参与次数推导且被队友伴随，避免推导与展示差 1 次。
    // 伊德海莉实数迭代期：喧响按 floor 后的整数次数算——若按实数，喧响→终结技阈值的
    // 4↔5 翻转会把实数次数拽成 2-循环（20.23↔20.35，必要时间随大翻跳）；floor 只影响
    // 迭代期喧响信道，终局整数重推后二者一致。
    // agentId 判断冗余已删（同 resolveExSpecialCount：exContinuous 唯一写入方 = yidhari.ts:148）。
    const decibelExCount = cfg.exContinuous === true
      ? Math.floor(exSpecialCount)
      : exSpecialCount
    const rawDecibel = calcRawDecibelParts(cfg, prev, chainCountInput, decibelExCount, prev.ultimateCount, totalTime, teamFrontline)
    shareableDecibels.push(rawDecibel.shareableTotal)
  }

  // Step 2: 计算队友伴随喧响
  const teammateShares: number[] = []
  for (let i = 0; i < configs.length; i++) {
    let share = 0
    for (let j = 0; j < configs.length; j++) {
      if (j === i) continue
      // 队友 j 的可分享喧响 × 队友 j 的分享比例
      share += shareableDecibels[j] * configs[j].decibelShareRatio
    }
    teammateShares.push(share)
  }

  // 卢西娅4命：帷幕开启/延长（含队友如伊德海莉大招开帷幕）→ 全队每人喧响；15s CD 封顶 × 利用率滑块。
  // 2026-09-25 CC-6b：角色数学迁进 lucia 模块的能力声明（规则 6），引擎按能力查询
  // （`getAgentMechanic(cfg.agentId)?.curtainTriggers`），队友开帷幕量由 `curtain-open` 跨槽
  // 供给收集成标量 ⇒ 本文件不再 import 角色模块、不写 agentId 字面量（详见 `./curtain.ts`）。
  const curtain = curtainInfoOf(configs, prevStates, totalTime)
  const curtainTriggers = curtain.triggers

  // Step 3: 计算总喧响和终结技次数
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const prev = prevStates[i]
    // 自身烧血喧响（如伊德海莉开局场外烧 75% + 战斗中把全部回复量烧掉；固定不可分享，参与终结技次数）。
    // 2026-09-26 CC-14b：角色数学迁进 yidhari 模块的能力声明（规则 6），引擎按能力查询；
    // 外部回血「每次 × 提供者终结技次数」由调用方按帷幕提供者槽结算后传入。
    const selfBurn = getAgentMechanic(cfg.agentId)?.selfBurnDecibel?.({
      cfg,
      basicAttackTime: prev.basicAttackTime,
      exSpecialCount: prev.exSpecialCount,
      providerUltCount: curtain.providerSlot >= 0 ? (prevStates[curtain.providerSlot]?.ultimateCount ?? 0) : 0,
    }) ?? 0
    const extraSelfDecibel = cfg.extraSelfDecibelReward
      + (cfg.extraSelfDecibelPerUltimate ?? 0) * (prev.ultimateCount + (cfg.ultimateEquivalentCount ?? 0))
      + (cfg.decibelPerCurtainTrigger ?? 0) * curtainTriggers
      // 诺姆影画4·膛温换连携：每次赠链「诺姆 + 上一位队友各 +200 不可分享喧响」，计入终结技次数。
      // 次数与门控由模块经 `crossAgentSupply` 自报（本文件不再 import 角色模块、不写 id）。
      + giftDecibelForCfg(configs, prevStates, cfg, totalTime)
      + selfBurn
    // 特殊动作奖励（本轮即时按连携/弹刀/闪反/快支次数结算）+ 异常奖励（上一轮异常池回填），均含队友伴随
    const externalDecibelBonus = (globalCfg.specialActionDecibelBonusPerSlot?.[i] ?? 0)
      + (globalCfg.anomalyDecibelBonusPerSlot?.[i] ?? 0)
    const totalDecibel = (cfg.initialDecibelGift + shareableDecibels[i] + teammateShares[i] + extraSelfDecibel
      + externalDecibelBonus) * decibelEfficiencyMultiplier(cfg)
    decibels.push(totalDecibel)
  }

  // Step 4: 计算必做动作前台时间、合轴抵扣与单角色前台时间
  // 先算总必做动作前台时间与每角色合轴（全额 + 可抵扣部分），再分配平A时间
  // 诺姆膛温换连携（C4）时间信道（2026-09-06 补账）：帽子把戏把「上一位队友」的快速支援替换为
  // 其本人连携技 hatCount 次——喧响侧已在 Step 3 extraSelfDecibel 计入，**时间侧此前漏账**：
  // 赠链行由 applyChainGift 在装配后追加、引擎必要时间没预留，实数化把时间线塞满后
  // 它把净占用顶出预算（实测 billy/norma 队 +14.2s）。按同一通道把 hatCount × 目标连携
  // 时长加进目标槽必要时间（GROSS 全额，合轴比随目标连携行口径）。
  // 数量/落点/单位耗时由模块的 `crossAgentSupply` 自报（引擎不 import 角色模块、不写 id）。
  // CC-35c-D 2026-09-27：赠链局部量去角色名（原 normaGift*/liuyinGift*）——取值早已走通用供给通道
  // `gift-chain:chain`（赠连携）/ `ultimateGiftOf`（赠终结技），名字里的角色只是历史残留。
  const chainGift = crossAgentSupplyAt(configs, prevStates, findCrossAgentSupplySlots(configs, 'gift-chain:chain')[0] ?? -1, {
    totalTime, stunCount: countStunOf(globalCfg), // CC-141：赠送供给属计数通道
  })
  const chainGiftTargetIdx = chainGift.count > 0 ? chainGift.targetIdx : -1
  const chainGiftTime = chainGift.time
  const totalNecessary: number[] = []
  const comboAlignTimes: number[] = []
  const comboAlignCredits: number[] = []
  // ===== 琉音好评转大赠链时间信道（2026-09-06 补账，诺姆膛温赠链同款）=====
  // applyUltimatePromote 装配后给「上一位队友」追加 promote 个终结技行（时间 = 目标 ult actionTime），
  // 旧实现靠 post-hoc carve 目标 basic_attack 聚合行守恒——目标平A时间住在分段行里时（希格莉德
  // 枪尖/般岳焚身/琉音猜拳）聚合行被抠剩 ~0、carve 落空 → 守恒破、净占用 +7.2s（实测
  // auto-1591-1481-1311）。引擎侧按同一求解预留必要时间：赠行时间进目标槽必要（GROSS），
  // 平A池随之收缩，守恒成立且不再依赖 post-hoc carve。
  //
  // **轴模式的次数来源 = `axisUltimatePromote`（编排层按「轴声明 60 + 剩余好评默认 90」算好）**：
  // 模块供给带 `axisSuppressed` ⇒ 轴模式下 `crossAgentSupplyAt` 恒返回 count 0。旧口径正是
  // 「轴模式不预留」（2026-09-10 为避数值重排暂时维持），其代价在 2026-09-20 暴露为**四处口径分裂**
  // —— 本处与 S2 折叠环 `rowTime` 漏计轴赠大，而 `giftTimeOfSlot`（截断上限）扣了它 ⇒ **双重计费**：
  // 雨果 0 命轴 slot0 截断额度被扣 8.732s 而账本/折叠都没涨，决算行被整数装包砍掉一整次（5→4，
  // 实测 `hugoVerdictLanding`/`stunVulnSummary` 案例 B/D 红）。
  // ⇒ 统一走 `ultimateGiftOf`（该量的**单一事实源**，四处同源才守恒：Σ非赠行 + 赠行 ≡ 账本）。
  //
  // 注意 `docs/ENGINE_PIPELINE_GUIDE.md` 坑19① 记的旧实测（「轴模式也在此预留会让 4 队留白变差
  // +0.27~2.70s」）是**只有本处单方面预留**时的读数：当时折叠环与截断上限的轴分支尚未落地，
  // 预留挤平A池而赠送行不等量补回（折叠环把它读成 idle 再 refund 掉，净额仍 0）。现四处同源，
  // 该否决理由的前提已消失（实测见下方 `@fact engine:赠送时间/轴模式四处同源`）。
  // @fact engine:赠送时间/轴模式四处同源 口径: 琉音赠大（`gift-chain:ultimate`）在轴模式下的**次数与时长必须四处同源**（`ultimateGiftOf` 单一事实源）：① 本处 `iterate` 账本必要时间预留 ② S2 折叠环 `rowTime` 测量 ③ `frontlineRowsOf` 试探测量 ④ `giftTimeOfSlot` 装配截断上限。四处缺任一（尤其①与②）都会破守恒——实测雨果 0 命轴只做④不做①②时，截断额度被扣 8.732s 而账本/折叠都没涨 ⇒ **双重计费**、决算行被整数装包砍掉一整次（5→4）| 据 用户@2026-09-20「同一个量转大次数，在轴模式下显示制定了部分好评值的用途，剩余好评应该默认 90」·复核@2026-09-25（W19：③ frontlineRowsOf 内联轴分支已收敛到 ultimateGiftOf）·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/composables/__tests__/timeLedgerInvariants.test.ts + src/composables/__tests__/hugoVerdictLanding.test.ts | 锚 src/core/resource/crossAgentSupply.ts#ultimateGiftOf | 信 确认
  // ⟳复核: 再增/删琉音赠大的消费点（尤其绕过 `ultimateGiftOf` 直调 `crossAgentSupplyAt`）时，复核「四处同源」覆盖面与 `Σ非赠行 + 赠行 ≡ 账本`（timeLedgerInvariants 全绿）；`axisUltimatePromote` 的产生改为非编排层时一并重核 | 到期 2027-03-31
  const ultGift = ultimateGiftOf(configs, prevStates, {
    totalTime, stunCount: countStunOf(globalCfg), // CC-141：赠送供给属计数通道
    axisMode: !!globalCfg.axisMode,
    axisPromote: globalCfg.axisUltimatePromote,
  })
  const ultGiftTargetIdx = ultGift.count > 0 && configs[ultGift.targetIdx] ? ultGift.targetIdx : -1
  const ultGiftTime = ultGiftTargetIdx >= 0 ? ultGift.time : 0
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const exSpecialCount = resolveExSpecialCount(cfg, energies[i])
    // 大招次数 = **槽位喧响总量**（用户 2026-09-10 裁决 A「总量为准」）：来源 = 自攒 + 赠送，
    // 消耗由总量决定而非个数。旧「时间轴推演反推次数」（每窗至多 1 次）已停用——它与轴栈
    // 「按总量执行（同窗可多次）」两套口径混用，见 docs 坑32。
    const ultimateCount = Math.floor(decibels[i] / cfg.ultimateCost)

    // 伊德海莉实数迭代期：必要时间用实数终结技期望（decibels/消耗）——整数 ult 在喧响阈值处
    // 4↔5 翻转会把实数强特次数拽成 2-循环（必要时间跳变 → 平A时间/回能/喧响同步跳变）；
    // 状态里 ult 仍是整数（终局一致），只有时间信道用实数参与收敛。
    // （旧「轴内喧响轨保持整数」的例外已随裁决 A 取消——轨不再反推次数。）
    // agentId 判断冗余已删：exContinuous 唯一写入方 = src/mechanics/agents/yidhari.ts:148。
    const realUltForTime = cfg.exContinuous === true
      && cfg.exFinalize !== true
    const ultForTime = realUltForTime ? decibels[i] / cfg.ultimateCost : ultimateCount

    // 时间信道阻尼（迭代期）：她的实数次数经「必要时间→共享平A池→队友回能→队友整数次数」
    // 与队友耦合，队友整数次数在阈值处翻转会把她的次数拽成 2-循环（如 19.54↔19.71，队友 6↔7）。
    // 必要时间按 (prev+new)/2 松弛：不动点不变（不动点处 prev==new），2-循环振幅每迭代减半，
    // 两个种子收敛到同一中点 → 终局 floor 唯一。终局重推（finalize）不阻尼（直接按整数账本重算）。
    // agentId 判断冗余已删（同 realUltForTime：exContinuous 唯一写入方 = yidhari.ts:148）。
    const exForTime = cfg.exContinuous === true
      && cfg.exFinalize !== true
      ? (prevStates[i].exSpecialCount + exSpecialCount) / 2
      : exSpecialCount

    // 连携次数 = 每次失衡连携次数 × 失衡次数（失衡次数由外部失衡池不动点收敛后传入 globalCfg.stunCount）
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = chainCountTotalOf(cfg, countStunOf(globalCfg))

    // 模块专属必做动作（CC-26；原内联蕾米埃尔垂虹）：与 rowBuild 补行同源，时间照旧按 count × actionTime 预留
    const extraActions = extraNecessaryActionOf(cfg, prevStates[i])
    const extraActionTime = extraActions.reduce((sum, a) => sum + a.count * a.actionTime, 0)
    const extraActionAlign = extraActions.reduce((sum, a) => sum + a.count * a.actionTime * a.comboAlignRatio, 0)
    const necessary = exSpecialNecessaryTime(cfg, exForTime, ultForTime, prevStates[i])
      + ultForTime * cfg.ultimateActionTime
      + chainCount * cfg.chainActionTime
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime
      + cfg.parryCount * cfg.assistFollowUpActionTime
      + (cfg.parryCount + cfg.parryNoFollowUpCount) * cfg.defensiveAssistActionTime
      // 反制支援（控制技整组化解）与弹刀同类：必做前台时间，账本必须预留（否则物化行顶出预算被截断）
      + Math.max(0, Math.floor(cfg.counterAssistCount)) * cfg.counterAssistActionTime
      + extraActionTime
      // 诺姆膛温换连携赠链时间（目标槽）：装配后 applyChainGift 追加的赠链行占前台，
      // 引擎必要时间必须预留（同连携 GROSS 全额口径），否则净占用顶出预算
      + (i === chainGiftTargetIdx ? chainGiftTime : 0)
      // 琉音好评转大赠链时间（目标槽，非轴）：装配后 applyUltimatePromote 追加的赠大行占前台，
      // 引擎预留（GROSS 全额口径），平A池随之收缩守恒——不再依赖 post-hoc carve
      + (i === ultGiftTargetIdx ? ultGiftTime : 0)
      // 时间预算收敛：执行计划中模块专属动作行（如雅霜月架势、叶瞬光飞光）占用前台但未计入
      // estimateExSpecialTime → Σ执行行时间超战斗时间；外层循环把超出部分折入必要时间，压缩平A池。
      + (cfg.timeBudgetExcess ?? 0)
    totalNecessary.push(necessary)

    // 合轴时间 = 各招式合轴部分之和（展示/非操作回能通道用全额）
    const giftComboAlign = i === chainGiftTargetIdx
      ? chainGiftTime * cfg.chainComboAlignRatio
      : 0
    const comboAlignGeneric =
      ultForTime * cfg.ultimateActionTime * cfg.ultimateComboAlignRatio
      + chainCount * cfg.chainActionTime * cfg.chainComboAlignRatio
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime * cfg.dodgeCounterComboAlignRatio
      + cfg.parryCount * cfg.assistFollowUpActionTime * cfg.assistFollowUpComboAlignRatio
      + (cfg.parryCount + cfg.parryNoFollowUpCount) * cfg.defensiveAssistActionTime * cfg.defensiveAssistComboAlignRatio
      + Math.max(0, Math.floor(cfg.counterAssistCount)) * cfg.counterAssistActionTime * cfg.counterAssistComboAlignRatio
      + extraActionAlign
      + giftComboAlign
    comboAlignTimes.push(exSpecialComboAlignTime(cfg, exForTime, ultForTime, prevStates[i]) + comboAlignGeneric)
    // 预算抵扣部分：通用项全额可抵扣（necessary 按全额计），强特项按 GROSS/NET 约定
    // ⚠ 账本不读 exec.comboAlignRatio：模块在行上写的比例只有经 extraNecessaryAction / estimateExSpecialTime / cfg setting 招式 / 赠行
    //   进到这里才算数，否则是死数据（CC-454）。锁 core/__tests__/comboAlignLedgerInvariant.test.ts（CC-455）会把这类行当场标红。
    comboAlignCredits.push(exSpecialComboAlignCredit(cfg, exForTime, ultForTime, prevStates[i]) + comboAlignGeneric)
  }

  // 总必做动作前台时间
  const sumNecessary = totalNecessary.reduce((a, b) => a + b, 0)
  // 合轴抵扣（团队级）：必做动作的合轴段与其他角色的动作并行，不占共享时间预算——
  // Σnecessary 允许 > 战斗时间（Σ>180），只要合轴抵扣后的净占用装得下。
  // 轴模式下栈引擎节省（axisOverlapByAction）与招式合轴率是同一物理并行的两种模型，
  // 按槽位取 max 不叠加（防同时设置时超扣；缺省合轴率全 0，退化为原口径）。
  // @fact engine:合轴预算抵扣 口径: 必做动作合轴段与其他角色动作并行、抵扣团队时间预算（Σnecessary 允许>战斗时间）；轴模式与栈引擎节省按槽取 max 不叠加；只抵扣含在 necessary 内的部分（GROSS 缺省，NET 模块照/卢西娅不重复抵） | 据 用户@2026-09-04·复核@2026-09-08·复核@2026-09-25·复核@2026-09-30 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/timeOccupation.ts#netFrontlineOccupation | 信 确认
  // @fact engine:单角色前线上限 口径: 单角色前台（必要+平A）≤ 战斗总时间——合轴抵扣放宽团队预算不放宽单人物理时间轴；贴顶截断的份额按剩余权重水填回流给还有余量的队友，不留池蒸发 | 据 用户@2026-09-05（改 09-04「留池不重分配」）·复核@2026-09-08·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/helpers.ts#iterate | 信 确认
  const overlapBySlot = axisOverlapBySlot(globalCfg.axisOverlapByAction)
  // CC-178：原「无按块分摊 → max(Σ抵扣, 团队总量)」兜底已删——无分摊时团队总量恒为 0，两式都退化为 Σ抵扣（逐位等价）
  const reliefSeconds = comboAlignCredits.reduce((sum, credit, i) => sum + Math.max(credit, overlapBySlot[configs[i].slot] ?? 0), 0)
  // 可分配平A时间 = 总时间 − 无敌时间 − 必做净占用（合轴抵扣后）+ 欠打回填（timeBudgetRefund，团队级）。
  // 无敌时间不扣能量/喧响回能，但扣平A池。
  const invTime = globalCfg.invincibleTime ?? 0
  const budget = totalTime - invTime
  // ===== 必要前台的可行性封顶（2026-09-05 用户口径：装不下就在时间线处截断，别回退成留白）=====
  // 各槽「想打」的必要前台（estimate + 折叠残差，扣掉合轴抵扣后的净占用）总和超过预算时，
  // 按**同一比例**压到装得下——不是逐槽拿队友的未封顶需求去算余量（那样两个厚槽会互相压成 0，
  // 实测把叶瞬光/琉音/诺姆队的失衡行全缩成 0 直接让 calcOutput 返回 null）。
  // 被压掉的部分**不再折进账本挤平A池**：账本按可行比例封顶（cappedNecessary），
  // 装配阶段再把超出账本的执行行按时间线截断（truncateExecutionsToFrontline）。
  // 旧行为：超出量一路折进 necessaryTime → 账本虚高 → 平A池被挤成 0 → 物化行反而打不满
  // （实测朱鸢队留白 93.7s、叶瞬光队 18~58s），虚高账本还会误触发模块的结构退化。
  const netNecessary = totalNecessary.map((n, i) => Math.max(0, n - (comboAlignCredits[i] ?? 0)))
  const sumNetNecessary = netNecessary.reduce((a, b) => a + b, 0)
  // **轴模式不封顶**（`axisMode` = 编排层轴态信号）：轴是用户
  // 指定的打法，超预算的正确处置是「轴退化/降配」显式报"这套轴在 180s 里不可操作"并弃轴重算，
  // 不能被静默截断（实测吞掉后 banyue.test「轴退化」判据不再触发）。非轴模式 = 自由循环，
  // 超预算就是"到点结算"，该截断 + 回灌平A。
  const axisMode = !!globalCfg.axisMode
  // ===== 动态合轴（债 2 R37-J5 v2，用户口径 2026-09-19）=====
  // 合轴不是录死的 ratio 数据（全库 1352 招只有 1 招有值，录死了下次溢出照样解不了），而是引擎在溢出时的动态吸收：
  // 多名角色同场时指定**操作角色 = 净必要最大的槽**（溢出发生的那槽），其余队友的前台按**溢出量**被合轴吸收
  // （与操作角色并行，团队预算不再重复计它们），吸收多少由溢出决定、按各自容量（净必要）比例分摊，不多不少；
  // 只有吸收不完的剩余才走下面的 feasibleScale 封顶 / 装配截断。单人 ≤ 战斗时间的上限不变（iterate 单角色前线上限）。
  // 实测（预设口径）只有 5/104 队会进这里（Σ必要 ≈ 预算、Σcredit = 0 的 1431 簇等），其余 99 队 excess ≤ 0 ⇒ 零分支。
  // 验：src/core/__tests__/dynamicComboAlign.test.ts。
  //
  // ★★★ **「吸收」的语义 = 把队友时间腾出来重新分配，不是「少算」（用户 2026-10-10，勿再误读）**
  //   用户原话：「**合轴就是多打，但我们逻辑已经把多打实现了，我说少算时间就是多余出时间给队友分配。
  //   这一块我认为没什么好说的，我解释也不止一次了。每次解释 agent 都不会理解真实意图而是想在开发侧
  //   直接实现意图，最后优化成现在这样。**」
  //   ⇒ ① 游戏侧的「合轴 = 多打」**已经由引擎别处实现了**（轴内并行节省 `axisOverlapBySlot`、静态
  //      `comboAlignRatio` 抵扣等）——**本段不是它的替代品，两者不冲突**。
  //      ② 本段的 `dynamicComboAlign` 是**分配手段**：溢出时把非主体槽的前台判为「与主体并行」，
  //      从而**腾出团队预算**再分给它们（`reliefWithDynamic` 回到平A池），**不是**把它们的动作"算少"。
  //      ⇒ **不要再把这里的「吸收」叙述成「游戏里多打 vs 引擎里少算、方向相反」**（2026-10-10 已误读一次）。
  //   ③ `operator` 是**算法占位符**（= 净必要最大者，即「耗时最长的那位」），**不是游戏里的「操作角色」**。
  //      它的全部作用是「从可吸收名单里排除一个槽」（见下方 `teammateNet`）⇒ **不要拿官方角色定位标签
  //      （`strategy[]` 站场/速切/后台）来"校正"它**：那 19/96 队的"冲突"来自把占位符当成了游戏概念。
  //      ⚠ 与角色技能原文里的「操作角色」（席德回能 / 丽娜影画2 等）**是两回事**，勿混。
  //   ④ **操作槽不参与吸收 = 有意的建模平移，不是漏建**（用户 2026-10-10 游戏场景问答，逐字）：
  //      「**游戏里不是，但我们这个计算逻辑做了简化，当你主c被并行让辅助上场时，我们记为辅助被并行。
  //      这样平移以后，便于计算，只修改一个变量就是合轴率，方便很多。**」
  //      ⇒ 游戏里主C 被并行（切辅助上场）的现象，引擎**等价平移**记到非操作槽上，目的是**把全部合轴
  //      复杂度收敛到 `comboAlignAbsorbRatio` 一个可调旋钮**。
  //      ⇒ **不要把「操作槽不可被吸收」当缺陷或建模缺口去"修"**：候选 C（对称吸收）实测虽有收益
  //      （主队 cut 12.56→0、伤害 +20.4%），但**波及 18/97 队、max +40.67%**，且它用**增加自由度**
  //      换取更贴游戏 ⇒ 与用户「单旋钮可调」的口径**方向相反**，已判**不采纳**（源码零改动）。
  //   ⑤ **有限次数招式的窗内/窗外放置：非轴 = 有意粗算，精确放置靠用户捏轴**（用户 2026-10-10 逐字）：
  //      「**这个就复杂了…要考虑对轴…某些招式你还要做决策，积攒到失衡还是直接放的收益谁高？
  //      这些复杂内容在计算器内我使用轴模式捏轴处理，自定义哪些招式在轴内。非轴就完全是粗算了**」
  //      ⇒ 非轴模式按时间比例均匀散布（= 现状 `u` 项口径）**是设计选择，不是待修的近似缺陷**；
  //      逐招 placement 的精确表达 = **轴预设 `actions[]` / `axisActionCounts`**（用户自己指定哪些招式在轴内，
  //      伤害池按捏轴切轴内/轴外两段，见 `damagePoolDirect.ts`）。⇒ **不要再为「非轴该按 (b)/(c) 放」立项。**

  // **轴态也吃吸收**（用户口径 2026-10-05，本条为 §20.5-3 的方向修正）：
  // 「捏轴只代表**失衡内**并行合轴了多少，**还有失衡外没有捏**，所以还是要吃 40% 合轴率的总合轴时间。」
  // ⇒ 吸收闸门**不带 `!axisMode`**：轴预设自带的 `axisOverlap` 只覆盖失衡内（轴块区间），
  // 失衡外的自由循环部分仍应按 40% 参与合轴。两者**不叠加**——`timeOccupation.ts:88` 的
  // `extraCredit = max(0, comboAlignCredit − axisOverlapBySlot)` 已实现「取大」口径，
  // 故轴内已并行掉的份额不会被重复扣（引擎既有架构与用户口径天然相容）。
  // ⚠ **「轴态不封顶」仍保留**（见 :513 的 `!axisMode`）：超预算的处置仍是「轴退化/降配」
  // 显式上报，吸收只减少溢出、不静默截断。（旧注释称「轴模式不做」= 已废止的口径，勿再引用。）
  // **吸收上限**（v3，用户口径 2026-09-19「全部吸收比较难，默认队友的 40% 可以被吸收（合轴率），超过了就无力合轴了」）：
  // 每名非操作角色的容量 = `comboAlignAbsorbRatio` × 其净必要（缺省 0.4，全局变量、可调、0 = 不吸收）；
  // 吸收不完的溢出**不再**被队友兜住 ⇒ 回到封顶 / 装配截断——结构性溢出队（1431 簇）在自由口径下重新可见。
  // @fact engine:动态合轴吸收上限 口径: 非操作角色可被合轴吸收的前台 ≤ comboAlignAbsorbRatio × 其净必要前台（全局变量，缺省 0.4，0 = 不吸收）；吸收总量 = min(溢出, Σ容量)，超出部分照旧封顶/截断。**轴态与非轴态同吃本吸收**（轴内 axisOverlap 只覆盖失衡内，失衡外仍按本比例参与），两者按 max 取大不叠加 | 据 用户@2026-09-19「全部吸收比较难…默认队友的40%可以被吸收（合轴率），超过了就无力合轴了」·用户@2026-10-05「捏轴只代表失衡内…失衡外没有捏，所以还是要吃 40% 合轴率的总合轴时间」 | 验 src/core/__tests__/dynamicComboAlign.test.ts | 锚 src/core/resource/timeOccupation.ts#calcTimeAllocation | 信 确认
  // ⟳复核: 用户再调缺省比例或改为按角色/按招式的上限时，复核「吸收总量 == min(溢出, Σ 0.4×净必要)」恒等式（dynamicComboAlign.test ①）+ 1431 簇预设口径截断量（timeGolden over 字段）| 到期 2026-12-31
  const absorbRatioRaw = globalCfg.comboAlignAbsorbRatio ?? DEFAULT_COMBO_ALIGN_ABSORB_RATIO
  const absorbRatio = Number.isFinite(absorbRatioRaw) ? Math.min(1, Math.max(0, absorbRatioRaw)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
  const dynamicComboAlign: number[] = configs.map(() => 0)
  if (absorbRatio > 0 && sumNetNecessary > budget + 1e-9 && configs.length > 1) {
    let operator = 0
    for (let i = 1; i < netNecessary.length; i++) if (netNecessary[i] > netNecessary[operator]) operator = i
    // 上限按**封顶后的最终前台**算，不是按吸收前的净必要：吸收不完的溢出会让下方 feasibleScale 把「未被吸收的部分」等比压缩，
    // 而被吸收的部分不压 ⇒ 若按吸收前净必要取 40%，队友终态前台里被并行的份额会远超 40%（实测 auto-1431-1481-1491：
    // 1481 终态 67.8s 里 57.1s 被判并行 = 84%）。令 s = 封顶比例、r = 上限，则约束 dyn_i ≤ r·[(net_i − dyn_i)·s + dyn_i]
    // ⇔ dyn_i ≤ net_i · g(s)，g(s) = r·s / (1 − r + r·s)；s 又由吸收量决定（s = 预算 / (Σ净必要 − Σdyn)）。
    // **求解器已外提为 `solveComboAlignTake`**（T119 批 1，闭式解；推导、分支表与回退点全在该函数头注释，
    // 口径与实测数字见 `docs/mcp-time-allocation-algorithms.md` §3.0/§3.1/§5 批 1）。本处只做「拆分 + 按容量比例摊」。
    // 相对旧 8 轮迭代：`take`/`dyn` 差 ≤ 8.04e-8s（浮点量级，**不是 0**），`cut`/伤害逐位不变；迭代轮数 41 → 1（r=0.4）。
    // @fact engine:动态合轴吸收/求解器 口径: 容量咬合（Δ > r·T）时吸收量取二次不动点方程 (★) 的小根 g*·T（闭式、一轮到位），不再跑 8 轮小迭代；r=1 走一次分支 take=min(Δ,T)；判别式舍入为负时回落原 8 轮迭代兜底 | 据 推导@T117（docs/mcp-time-allocation-algorithms.md §3.0）+ T119 采纳决策表 ② | 验 src/core/__tests__/comboAlignClosedForm.test.ts | 锚 src/core/resource/helpers.ts#solveComboAlignTake | 信 高
    // ⟳复核: 若有人再改吸收上限的**口径**（改「上限按封顶后终态算」这条前提，如候选 B/C），则 (★) 的推导地基消失 ⇒ 重新推导并重取 `cut`/`dyn` 读数；另复核 `legacyComboAlignTake` 兜底是否真在生产 97 队上零触发 | 到期 2027-04-30
    const teammateNet = netNecessary.map((n, i) => (i === operator ? 0 : Math.max(0, n)))
    const teammateTotal = teammateNet.reduce((a, b) => a + b, 0)
    if (teammateTotal > 1e-9) {
      const sol = solveComboAlignTake(sumNetNecessary, budget, teammateTotal, absorbRatio)
      // 批 2 诊断量（T123b）：把求解器的 `converged`/`iterations` 接到既有 `globalCfg` 副作用通道上
      // （与 `timeFeasibleScale`/`overflowSeconds` 同形：计算中途写回，调用前恒为 undefined）。
      // 读法与盲区见 `ResourceCalcConfig.dynamicComboAlignConverged` 与 `TeamResourceResult` 同名字段。
      globalCfg.dynamicComboAlignConverged = sol.converged
      globalCfg.dynamicComboAlignIterations = sol.iterations
      const take = sol.take
      for (let i = 0; i < teammateNet.length; i++) dynamicComboAlign[i] = teammateNet[i] / teammateTotal * take
    }
  }
  // 闸门未开（无溢出 / 比例为 0 / 单人）⇒ 没有子问题可解，写成「真空收敛 + 0 轮」而不是留 undefined：
  // 读法恒为「本次调用最后一次 iterate 的读数」，无 undefined 分支。**这也让反空洞下限可写**——
  // 判据扫「`iterations > 0` 的队数 ≥ 下限」即可证明扫描面真的走到了求解器（见 comboAlignClosedForm.test ⑥）。
  if (dynamicComboAlign.every(d => d === 0)) {
    globalCfg.dynamicComboAlignConverged = true
    globalCfg.dynamicComboAlignIterations = 0
  }
  const dynamicTotal = dynamicComboAlign.reduce((a, b) => a + b, 0)
  const effectiveCredits = comboAlignCredits.map((c, i) => c + dynamicComboAlign[i])
  const absorbedNetNecessary = netNecessary.map((n, i) => Math.max(0, n - dynamicComboAlign[i]))
  const sumAbsorbedNet = absorbedNetNecessary.reduce((a, b) => a + b, 0)
  // 动态吸收与轴内合轴节省同槽**取大**不叠加（本段头注释口径；`timeOccupation.ts#slotNetFrontline` 同式）：
  // max(c + d, o) = max(c, o) + d − min(d, max(0, o − c))（c 静态抵扣、d 动态吸收、o 该槽轴内节省，均 ≥ 0）。
  // r709 前直接相加（o = 0 时无差）；节省复活后同槽多给一份 relief ⇒ 平A池超发、占用拆解按取大判超时 ⇒ 轴被误退化
  //（实测 auto-1461-1521-1361 超 4.38s = 槽1 轴内节省）。o = 0 时减项恰为 0，逐位同旧。
  const overlapDynamicDup = dynamicComboAlign.reduce(
    (sum, d, i) => sum + Math.min(d, Math.max(0, (overlapBySlot[configs[i].slot] ?? 0) - comboAlignCredits[i])), 0)
  const reliefWithDynamic = reliefSeconds + dynamicTotal - overlapDynamicDup
  const rawScale = !axisMode && sumAbsorbedNet > budget && sumAbsorbedNet > 0
    ? budget / sumAbsorbedNet
    : 1
  const feasibleScale = rawScale
  // ⚠ 本封顶处的债务标记已于 2026-09-18（R24 批 1-3）**销号**——原标记称「本封顶让未实数化
  //   整数队的落点可随初值差 ±1 次强特（实测琉音 24/23）」，该量化依据经三条独立实测**证伪**：
  //   ① 批 1-0（`seedInvariance.test.ts` 第三档）104 预设 × 4 种子次数落点逐位相等；
  //   ② R24 手组队矩阵（8 个强特取整模块（当时字段 exSpecialCountFloor；CC-324 起取整为缺省） × 3 组队友 × 11 种子 = 385 次）违反 0；
  //   ③ R25 复核：**生产落点 cfg**（"被接受那次调用"的 `before` 快照，见 `seedInvariance` 的
  //      `acceptedCall`）104 队 × 4 种子次数违反 0 ⇒ 本分支在当前数据面上不改变任何一队的落点。
  //   琉音「24/23」在 HEAD 上不可复现（6 支队 ex∈{23,24,50} 全部 SAME，落点 26~29）。
  //   同时 `:1270` 处 1a 标记及对应 DEBT_REGISTRY 条目亦已一并注销（批 1-3 全面收口）。
  // ⚠ **R24 原记的第 ③ 条后半句「封顶本身在生产落点上激活 0/104 队（`feasibleScale` 恒 1）」
  //   已被 R25 实测证伪，别再引用**：封顶（`timeFeasibleScale ≠ 1`）在**探路轮与生产落点两个
  //   截面上都激活 10/104 队**（`auto-1431-*` 一族，scale 低至 0.25）。
  //   R24 的 `1.000000` 是**残留字段读法**的产物：本字段写回 `globalCfg`，而 `calcTeamResources`
  //   每次调用拿到的是**新克隆** ⇒ 在调用**前**读它恒为 `undefined ?? 1 = 1`（实测 0/104 队 ≠ 1），
  //   **只有冷跑一次再读才拿到真值**（10/104）。⇒ 销号结论不受影响（靠的是次数违反 0，判据①），
  //   但"封顶不激活"不能作为销号证据。凡读本字段（及 `overflowSeconds`/`converged` 同类
  //   cfg 副作用字段）都必须确认它是**本次调用**写入的。
  // 封顶后的必要前台：净占用按可行比例缩回预算（合轴抵扣部分原样保留，它不占预算）。
  // 这个 capped 值**同时**用于平A池计算与 state.necessaryTime ⇒ 省下来的必要时间变成队友
  // 能打的平A填充，而不是"账本说满了、动作没打满"的假满（实测：不回灌留白 393s，回灌 275s）。
  //
  // ★★★ **三层降级顺序 = 平A → 合轴率 → 全员平等等比（用户 2026-10-10，勿再问「③ 加权分摊要不要做」）**
  //   用户原话（逐字）：「**我们首先有平a灵活可分配时间，其次有合轴率包容，如果这两个都没承担住，
  //   那只能全都承担了。因为简单逻辑无法识别压缩谁最有利，只能全部都平等了**」
  //   ⇒ 本文件的三层与之**逐层对应**：① 平A池回灌 = 下方 `availableBasicTime`；
  //      ② 合轴率包容 = 上方 `dynamicComboAlign`（40% 吸收，非操作槽）；③ 本行的 `feasibleScale`
  //      = `budget / sumAbsorbedNet`。
  //   ⇒ **③「加权分摊」（让操作角色承担 `1/n` 而不是 0）判为不采纳**，理由就是用户那句
  //      「简单逻辑无法识别压缩谁最有利」：给操作槽加权重 = **假装引擎能判断「压谁更划算」**，
  //      而它不能。**全员平等是诚实的选择，不是偷懒**——不要把 `absorbedNetNecessary` 的全槽无豁免
  //      当成「漏了主C 的豁免」去"修"。
  //   ⇒ **主C 在前两层被豁免（不被吸收），到第三层与队友同等承担**（`absorbedNetNecessary` 是全槽
  //      数组、无槽位判定）——这正是「这两个都没承担住，那只能全都承担了」的实现。
  const cappedNecessary = absorbedNetNecessary.map((x, i) =>
    x * feasibleScale + (effectiveCredits[i] ?? 0))
  const sumNecessaryCapped = cappedNecessary.reduce((a, b) => a + b, 0)
  // @fact engine:cfg/诊断量写回 口径: timeFeasibleScale 与 overflowSeconds 是引擎计算中途写回 globalCfg 的诊断量，在新克隆 cfg 上调用前恒为 undefined，严禁在调用前预读作条件判定；读截断秒数必须读 convergence.timeTruncatedSeconds | 据 用户@2026-09-18·R25-J2·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/helpers.ts#iterate | 信 确认
  // ⟳复核: 检查是否有外部模块误读 timeFeasibleScale 或 overflowSeconds | 到期 2026-12-31
  globalCfg.timeFeasibleScale = feasibleScale
  globalCfg.overflowSeconds = Math.max(0, sumNecessary - reliefWithDynamic - budget)
  const availableBasicTime = Math.max(0, budget - sumNecessaryCapped + reliefWithDynamic
    + (globalCfg.timeBudgetRefund ?? 0))

  // 按权重分配平A时间
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)
  // 截断份额回流队友（2026-09-05 用户裁决，替代 09-04 的「留池蒸发」口径）：单人前台
  // （必要 + 平A）≤ 战斗总时长是物理上限，某槽按权重分到的份额超出他的剩余物理时间时，
  // 旧做法是把超出量直接丢在池里蒸发——合轴抵扣放宽团队预算后尤其浪费（池打开了，
  // 却因单人贴顶而没人接）。改为水填法（water-filling）：每轮把池按**剩余权重**分给
  // 还有余量的槽，贴顶的槽退出，至多 configs.length 轮必然收敛（每轮至少一个槽退出）。
  const basicAlloc = new Array<number>(configs.length).fill(0)
  if (totalWeight > 0 && availableBasicTime > 0) {
    let pool = availableBasicTime
    for (let round = 0; round < configs.length && pool > 1e-9; round++) {
      const open: Array<{ idx: number; headroom: number; w: number }> = []
      for (let i = 0; i < configs.length; i++) {
        const headroom = Math.max(0, totalTime - totalNecessary[i]) - basicAlloc[i]
        if (configs[i].timeWeight > 0 && headroom > 1e-9) open.push({ idx: i, headroom, w: configs[i].timeWeight })
      }
      if (open.length === 0) break
      const wSum = open.reduce((a, o) => a + o.w, 0)
      let used = 0
      for (const o of open) {
        const give = Math.min(o.headroom, pool * (o.w / wSum))
        basicAlloc[o.idx] += give
        used += give
      }
      pool -= used
      if (used <= 1e-9) break
    }
  }

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const exSpecialCount = resolveExSpecialCount(cfg, energies[i])
    // 与 Step4 同口径：大招次数 = 槽位喧响总量（裁决 A）
    const ultimateCount = Math.floor(decibels[i] / cfg.ultimateCost)

    const necessary = cappedNecessary[i]
    /**
     * 封顶**之前**的账本份额（只在 `feasibleScale < 1` 时写）——折叠环对**它**收敛，
     * 不对封顶后的 `necessary`。理由见 `IterationState.necessaryUncappedTime` 头注释：
     * 对封顶后的账本收敛会与封顶构成正反馈（`acc ↑ ⇒ scale ↓ ⇒ 账本 ↓ ⇒ excess ↑ ⇒ acc ↑`），
     * 把「封顶砍掉的秒数」误记成欠账。缺省 `undefined` ⇒ 折叠环回落 `necessaryTime`，
     * 封顶未激活（全库 104 队里 94 队）时本字段不出现，路径逐位不变。
     */
    const necessaryUncapped = feasibleScale < 1
      ? absorbedNetNecessary[i] + (effectiveCredits[i] ?? 0)
      : undefined
    // 单角色前台硬顶：合轴抵扣放宽的是团队预算，单个角色自身时间轴仍受战斗总时长约束
    // （前台 = 必要 + 平A ≤ totalTime）。水填结果即该槽平A时间——贴顶截断的份额已在
    // 上面的轮次按剩余权重回流给还有余量的队友（不蒸发）。
    const basicAttackTime = basicAlloc[i]

    // 连携次数（与第一个循环同一读取口 CC-505）：每次失衡连携次数 × 失衡次数
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = chainCountTotalOf(cfg, countStunOf(globalCfg))

    const frontlineTime = necessary + basicAttackTime
    const backstageTime = Math.max(0, totalTime - frontlineTime)

    // 伊德海莉迭代期状态写入阻尼值（与必要时间信道同源）：原始实数次数经共享平A池与队友整数
    // 次数耦合会 2-循环（19.54↔19.71），状态与时间信道统一按 (prev+new)/2 松弛——不动点不变，
    // 2-循环振幅每迭代减半，两个种子收敛到同一中点，终局 floor 唯一。终局重推（finalize）写整数。
    // agentId 判断冗余已删（exContinuous 唯一写入方 = src/mechanics/agents/yidhari.ts:148）。
    const storedEx = cfg.exContinuous === true && cfg.exFinalize !== true
      ? (prevStates[i].exSpecialCount + exSpecialCount) / 2
      : exSpecialCount

    newStates.push({
      basicAttackTime,
      exSpecialCount: storedEx,
      ultimateCount,
      chainCountTotal: chainCount,
      totalEnergy: energies[i],
      energySource: energySnapshots[i],
      totalDecibel: decibels[i],
      necessaryTime: necessary,
      ...(necessaryUncapped !== undefined ? { necessaryUncappedTime: necessaryUncapped } : {}),
      frontlineTime,
      backstageTime,
      comboAlignTime: comboAlignTimes[i],
      comboAlignCredit: effectiveCredits[i],
      dynamicComboAlignSeconds: dynamicComboAlign[i] > 0 ? dynamicComboAlign[i] : undefined,
    })
  }

  return newStates
}

// ============ 主计算函数 ============

/** 资源池主计算入口 */
