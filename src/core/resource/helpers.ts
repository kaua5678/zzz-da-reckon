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
import { computeLuciaCurtainTriggers } from '@/mechanics/agents/luciaElowen'
import { computeBanyueCycleFromCfg, readAxisExCounts } from '@/mechanics/agents/banyue'
import { crossAgentSupplyAt, findCrossAgentSupplySlots, ultimateGiftOf, giftDecibelForCfg } from './crossAgentSupply'
import { DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'

/**
 * 计数通道用的失衡次数（C7 投影；`globalCfg.stunPlanProjection='off'` 时**恒等** ⇒ 0 delta）。
 * 只替换「把计划值当次数乘」的地方（连携/喧响/能量）；时间账与不动点迭代继续读实数 `globalCfg.stunCount`。
 * 见 `core/stunPlanProjection.ts`。
 */
function countStunOf(globalCfg: ResourceCalcConfig): number {
  return projectStunPlanForCounts(globalCfg.stunCount ?? 0, globalCfg.stunPlanProjection ?? 'off')
}

// ============================================================================
// 跨角色联动回能族（`calcCrossAgentEnergy` / `emptyCrossAgentEnergy`）已整段迁至
// `./crossAgentEnergy.ts`（R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`core/resource.ts` / `iterate` /
// `mechanics/__tests__` / `composables/__tests__`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './crossAgentEnergy'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改跨角色回能口径请改 `./crossAgentEnergy.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import { calcCrossAgentEnergy, emptyCrossAgentEnergy } from './crossAgentEnergy'
export { calcCrossAgentEnergy, emptyCrossAgentEnergy }

// ============================================================================
// 单角色资源收入账本族（`calcEnergySource` / `calcRawDecibelParts` / `calcDecibelSource`）
// 已整段迁至 `./resourceIncome.ts`（R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`core/resource.ts` 装配 / `iterate` /
// `core/__tests__` / `mechanics/__tests__`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './resourceIncome'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改收入账本口径请改 `./resourceIncome.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import { calcEnergySource, calcRawDecibelParts, calcDecibelSource } from './resourceIncome'
export { calcEnergySource, calcRawDecibelParts, calcDecibelSource }

// ============================================================================
// 行级收入账本 + 利用率/冷却切片族（`decibelEfficiencyMultiplier` /
// `remielleSpecialVoidflareUseCount` / `cappedCooldownTriggers` / `getUtilizedCount` /
// `applyExecutionUtilization` / `applyEventUtilization` / `timeSliceTriggerCounts`）
// 已整段迁至 `./rowAccounting.ts`（R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`core/resource.ts` / `iterate` /
// `./rowBuild.ts` / 各测试）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './rowAccounting'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改行级收入/利用率口径请改 `./rowAccounting.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import {
  decibelEfficiencyMultiplier,
  remielleSpecialVoidflareUseCount,
  cappedCooldownTriggers,
  getUtilizedCount,
  applyExecutionUtilization,
  applyEventUtilization,
  timeSliceTriggerCounts,
} from './rowAccounting'
import {
  // 私有符号：跨缝被 iterate 消费。本文件 **import 但不 re-export**（公开面零增零减）。
  exSpecialNecessaryTime,
  exSpecialComboAlignTime,
  exSpecialComboAlignCredit,
} from './rowAccounting'
export {
  decibelEfficiencyMultiplier,
  remielleSpecialVoidflareUseCount,
  cappedCooldownTriggers,
  getUtilizedCount,
  applyExecutionUtilization,
  applyEventUtilization,
  timeSliceTriggerCounts,
}

// ============================================================================
// 时间分配 + 前台占用拆解族（`calcTimeAllocation` / `FrontlineOccupationBreakdown` /
// `frontlineOccupationBreakdown` / `netFrontlineOccupation`）已整段迁至
// `./timeOccupation.ts`（R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`useResourceCalc` / `teamCompare` /
// `difficultyCurve` / `teamTimeSummary` / `iterate` 与各测试）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './timeOccupation'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改前台占用/时间分配口径请改 `./timeOccupation.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import {
  calcTimeAllocation,
  frontlineOccupationBreakdown,
  netFrontlineOccupation,
} from './timeOccupation'
import type { FrontlineOccupationBreakdown } from './timeOccupation'
export {
  calcTimeAllocation,
  frontlineOccupationBreakdown,
  netFrontlineOccupation,
}
export type { FrontlineOccupationBreakdown }

// ============================================================================
// 时间线截断族（`TIME_FOLD_CONVERGENCE_SECONDS` / `truncateExecutionsToFrontline`）
// 已整段迁至 `./timeTruncation.ts`（R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`core/resource.ts` 装配截断 / `./rowBuild.ts` /
// `composables/__tests__/timeTruncation.test.ts`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './timeTruncation'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改截断口径请改 `./timeTruncation.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import { TIME_FOLD_CONVERGENCE_SECONDS, truncateExecutionsToFrontline } from './timeTruncation'
export { TIME_FOLD_CONVERGENCE_SECONDS, truncateExecutionsToFrontline }


// ============================================================================
// 招式执行行构建族（`materializeRows` / `feasibleRows` / `buildExecutions` /
// `buildAnomalyEventExecutions`）已整段迁至 `./rowBuild.ts`
// （R43 结构熵切面，纯搬运）。
// 本块是 **re-export 壳**：既有消费者（`core/resource.ts` 装配 / `./resourceIncome.ts` /
// `core/__tests__`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './rowBuild'`
// **不建本地绑定**（R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改行构建口径请改 `./rowBuild.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import { materializeRows, feasibleRows, buildExecutions, buildAnomalyEventExecutions } from './rowBuild'
export { materializeRows, feasibleRows, buildExecutions, buildAnomalyEventExecutions }

// ============ 单次迭代 ============

/**
 * 计算强特次数。
 * 伊德海莉：失衡内强特由失衡轴连段反推（yidhariInStunExCount），
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
  if (cfg.agentId === '1471') {
    // 般岳：强特总次数由嗔火/怒相循环决定（怒相内山威免费 + 怒相外付费连段 + 地动滑块 + 轴内捏的普通强特），
    // 不能用 闪能/20 —— 免费强特不耗闪能；轴内连段块不重复计（认领怒相内/外行，池守恒）
    const c = computeBanyueCycleFromCfg(cfg)
    const axisEx = readAxisExCounts(cfg)
    let axisNormal = 0
    for (const [k, v] of Object.entries(axisEx)) if (k !== 'banyue-combo' && k !== 'banyue-combo-didong') axisNormal += v
    return c.lunDaoRageCount + c.shiZiHouNuCount + c.shanYaoRageCount
      + c.diDongRageCount + c.shanYaoNuRageCount
      + c.lunDaoOutCount + c.shiZiHouNuOutCount
      + c.diDongOutCount + c.shanYaoNuOutCount
      + axisNormal
  }
  // agentId 判断冗余已删：yidhariContinuousEx 唯一写入方 = src/mechanics/agents/yidhari.ts:148
  // （模块只对自己的 cfg 运行 ⇒ 字段为 true 即蕴含 agentId === '1051'），引擎层不读 agentId。
  if (cfg.yidhariContinuousEx === true && (cfg.yidhariRefundPerOutStunEx ?? 0) > 0) {
    // debt: 全局实数化收敛重构（正反馈模块统一连续通道 + 逐模块重校准）——本分支是 1051 的 targeted
    // 修复（解析不动点 + 阻尼实数迭代 + 终局整数重推）；全局「实数化松弛、终局才 floor」会重排所有
    // 带时间/资源循环模块的均衡（sigrid 出枪式消失前例），需专项按模块重校准。
    // ⚠ 本标记（1a）**保留**：R24 批 1-3 只销掉同名的 1b（可行性封顶处那条，其量化依据
    //   「落点随初值差 ±1 次强特」已被三条独立实测证伪）。1a 的前提是「1051 的 refund 自指反馈
    //   **只能**按角色开洞、无法用声明式通用通道表达」——该前提**未做验证**（批 1-1 通用连续通道
    //   抽象未开工）⇒ 不许随 1b 一并删（规则 16③：没量过的不算证伪）。
    // @fact yidhari:refund不动点 口径: 极寒重碾非失衡每发回15闪能属自指反馈——迭代期强特次数实数化（refund解析求解+必要时间信道阻尼）唯一连续不动点，floor只在终局整数重推发生一次（不在迭代中途截断资源循环）；曾致19/20双稳态（种子相关，parry4/dodge10、parry8/dodge2复现），勿改回「迭代期回读整数次数+floor」 | 据 用户@2026-09-04·复核@2026-09-08 | 验 src/composables/__tests__/yidhariInteractionGrid.test.ts | 锚 src/core/resource/helpers.ts#resolveExSpecialCount | 信 确认
    // 伊德海莉 refund 反馈连续松弛（2026-09-04 修复 19/20 双稳态，用户口径「floor 应该最后算」）：
    // 迭代期强特次数以实数参与收敛（refund 已解析求解，见 calcEnergySource），唯一不动点；
    // 终局整数重推（calcTeamResources）冻结非失衡整数次数后重推，floor 只发生一次。
    const consume = cfg.exSpecialEnergyConsume
    const finalize = cfg.yidhariFinalizeEx === true
    if (cfg.yidhariInStunExCount !== undefined) {
      const inStun = cfg.yidhariInStunExCount
      const inStunCost = cfg.yidhariInStunEnergyCost ?? inStun * consume
      const remaining = totalEnergy - inStunCost
      const outStun = remaining > 0 ? remaining / consume : 0
      return inStun + (finalize ? Math.floor(outStun) : outStun)
    }
    const paid = totalEnergy / consume
    return finalize ? Math.floor(paid) : paid
  }
  // 伊德海莉失衡内强特：字段非 undefined 即蕴含是该角色（唯一写入方 = convergence.ts 的
  // `merged.agentId === '1051'` 分支 ⇒ 只写它自己那份 cfg）⇒ agentId 判断冗余，已删
  // （2026-09-15 core 棘轮批次2，判据同 T6）。
  if (cfg.yidhariInStunExCount !== undefined) {
    const inStun = cfg.yidhariInStunExCount
    const inStunCost = cfg.yidhariInStunEnergyCost ?? inStun * cfg.exSpecialEnergyConsume
    const remaining = totalEnergy - inStunCost
    const outStun = remaining > 0 ? Math.floor(remaining / cfg.exSpecialEnergyConsume) : 0
    return inStun + outStun
  }
  const paid = cfg.exSpecialCountFloor || !cfg.skipGenericExSpecial
    ? Math.floor(totalEnergy / cfg.exSpecialEnergyConsume)
    : totalEnergy / cfg.exSpecialEnergyConsume
  // 免费强特（如南宫羽每次失衡一次免能E）：不占闪能预算，照常计次/计时/喧响
  return paid + Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
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
 */
export function iterate(
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
    const chainCountInput = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * countStunOf(globalCfg)
    // 行级能量/喧响 Σ 需要队友前台秒（与装配层 teammateFrontlineSeconds 同语义：Σ 其他人，迭代期取上一轮值，
    // 收敛后与终局装配一致）
    const teamFrontline = prevStates.reduce((sum, st, k) => (k === i ? sum : sum + (st.frontlineTime ?? 0)), 0)
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
    // agentId 判断冗余已删（同 resolveExSpecialCount：yidhariContinuousEx 唯一写入方 = yidhari.ts:148）。
    const decibelExCount = cfg.yidhariContinuousEx === true
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

  // 卢西娅4命：帷幕开启/延长（含队友如伊德海莉大招开帷幕）→ 全队每人喧响；15s CD 封顶 × 利用率滑块
  // 2026-09-15 core 棘轮批次4：伊德海莉按**模块专属字段**找槽（`yidhariDecibelPerHpPct` 的
  // 唯一写入方 = yidhari.ts 的 buildCharConfig，无条件写、且无 `?? 默认` ⇒ 字段存在即蕴含是该角色）。
  // ⚠ 卢西娅这半**保持 agentId**：`luciaCinemaLevel` 在 iterate 的这条路径上实测为 undefined
  // （写在编排层的另一份 cfg 上），改字段判据会让 luciaSlot 恒 -1（详见 resource.ts 同款注释）。
  const luciaSlot = configs.findIndex(c => c.agentId === '1451')
  const yidhariSlot = configs.findIndex(c => c.yidhariDecibelPerHpPct !== undefined)
  const curtainCoverage = configs.find(c => c.luciaC4CurtainCoverage !== undefined)?.luciaC4CurtainCoverage ?? 1
  const curtainTriggers = luciaSlot >= 0
    ? computeLuciaCurtainTriggers(
        prevStates[luciaSlot]?.exSpecialCount ?? 0,
        prevStates[luciaSlot]?.ultimateCount ?? 0,
        yidhariSlot >= 0 ? (prevStates[yidhariSlot]?.ultimateCount ?? 0) : 0,
        curtainCoverage,
        totalTime,
      )
    : 0

  // Step 3: 计算总喧响和终结技次数
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const prev = prevStates[i]
    // 伊德海莉烧血喧响：开局场外烧 75% + 战斗中把全部回复量烧掉（固定不可分享，参与终结技次数）
    const yidhariBurn = (() => {
      // 同上方 yidhariBurnDecibel：用无默认值的模块专属字段判别（2026-09-15 core 棘轮批次2）。
      if (cfg.yidhariDecibelPerHpPct === undefined) return 0
      const missing = Math.max(0, Math.min(1, cfg.yidhariExHealMissingHpPct ?? 0.75))
      const decibelPerHp = cfg.yidhariDecibelPerHpPct ?? 10
      // 外部回血（卢西娅星光汇聚之地）：固定部分 + 按卢西娅终结技次数结算部分（%自身最大生命值）
      const external = Math.max(0, (cfg.yidhariExternalHealPct ?? 0)
        + (cfg.yidhariExternalHealPerUltPct ?? 0) * (luciaSlot >= 0 ? (prevStates[luciaSlot]?.ultimateCount ?? 0) : 0))
      const cycleTime = 1 + (cfg.yidhariChargeSlam?.actionTime ?? 0) + (cfg.yidhariBasicFollow?.actionTime ?? 0)
      const cycles = cycleTime > 0 ? Math.floor((prev.basicAttackTime ?? 0) / cycleTime) : 0
      const exHeal = (prev.exSpecialCount ?? 0) * 33 * missing
      const followHeal = cycles * 10
      return (75 + exHeal + followHeal + external) * decibelPerHp
    })()
    const extraSelfDecibel = (cfg.extraSelfDecibelReward ?? 0)
      + (cfg.extraSelfDecibelPerUltimate ?? 0) * prev.ultimateCount
      + (cfg.luciaC4DecibelPerTrigger ?? 0) * curtainTriggers
      // 诺姆影画4·膛温换连携：每次赠链「诺姆 + 上一位队友各 +200 不可分享喧响」，计入终结技次数。
      // 次数与门控由模块经 `crossAgentSupply` 自报（本文件不再 import 角色模块、不写 id）。
      + giftDecibelForCfg(configs, prevStates, cfg, totalTime)
      + yidhariBurn
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
  // 赠链行由 applyNormaHatChain 在装配后追加、引擎必要时间没预留，实数化把时间线塞满后
  // 它把净占用顶出预算（实测 billy/norma 队 +14.2s）。按同一通道把 hatCount × 目标连携
  // 时长加进目标槽必要时间（GROSS 全额，合轴比随目标连携行口径）。
  // 数量/落点/单位耗时由模块的 `crossAgentSupply` 自报（引擎不 import 角色模块、不写 id）。
  const normaGift = crossAgentSupplyAt(configs, prevStates, findCrossAgentSupplySlots(configs, 'gift-chain:chain')[0] ?? -1, {
    totalTime, stunCount: globalCfg.stunCount ?? 0,
  })
  const normaGiftTargetIdx = normaGift.count > 0 ? normaGift.targetIdx : -1
  const normaGiftChainTime = normaGift.time
  const totalNecessary: number[] = []
  const comboAlignTimes: number[] = []
  const comboAlignCredits: number[] = []
  // ===== 琉音好评转大赠链时间信道（2026-09-06 补账，诺姆膛温赠链同款）=====
  // applyLiuyinPromote 装配后给「上一位队友」追加 promote 个终结技行（时间 = 目标 ult actionTime），
  // 旧实现靠 post-hoc carve 目标 basic_attack 聚合行守恒——目标平A时间住在分段行里时（希格莉德
  // 枪尖/般岳焚身/琉音猜拳）聚合行被抠剩 ~0、carve 落空 → 守恒破、净占用 +7.2s（实测
  // auto-1591-1481-1311）。引擎侧按同一求解预留必要时间：赠行时间进目标槽必要（GROSS），
  // 平A池随之收缩，守恒成立且不再依赖 post-hoc carve。
  //
  // **轴模式的次数来源 = `axisLiuyinPromote`（编排层按「轴声明 60 + 剩余好评默认 90」算好）**：
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
  // @fact engine:赠送时间/轴模式四处同源 口径: 琉音赠大（`gift-chain:ultimate`）在轴模式下的**次数与时长必须四处同源**（`ultimateGiftOf` 单一事实源）：① 本处 `iterate` 账本必要时间预留 ② S2 折叠环 `rowTime` 测量 ③ `frontlineRowsOf` 试探测量 ④ `giftTimeOfSlot` 装配截断上限。四处缺任一（尤其①与②）都会破守恒——实测雨果 0 命轴只做④不做①②时，截断额度被扣 8.732s 而账本/折叠都没涨 ⇒ **双重计费**、决算行被整数装包砍掉一整次（5→4）| 据 用户@2026-09-20「同一个量转大次数，在轴模式下显示制定了部分好评值的用途，剩余好评应该默认 90」 | 验 src/composables/__tests__/timeLedgerInvariants.test.ts + src/composables/__tests__/hugoVerdictLanding.test.ts | 锚 src/core/resource/crossAgentSupply.ts#ultimateGiftOf | 信 确认
  // ⟳复核: 再增/删琉音赠大的消费点（尤其绕过 `ultimateGiftOf` 直调 `crossAgentSupplyAt`）时，复核「四处同源」覆盖面与 `Σ非赠行 + 赠行 ≡ 账本`（timeLedgerInvariants 全绿）；`axisLiuyinPromote` 的产生改为非编排层时一并重核 | 到期 2027-03-31
  const liuyinGift = ultimateGiftOf(configs, prevStates, {
    totalTime, stunCount: globalCfg.stunCount ?? 0,
    axisMode: !!globalCfg.axisMode,
    axisPromote: globalCfg.axisLiuyinPromote,
  })
  const liuyinGiftTargetIdx = liuyinGift.count > 0 && configs[liuyinGift.targetIdx] ? liuyinGift.targetIdx : -1
  const liuyinGiftTime = liuyinGiftTargetIdx >= 0 ? liuyinGift.time : 0
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
    // agentId 判断冗余已删：yidhariContinuousEx 唯一写入方 = src/mechanics/agents/yidhari.ts:148。
    const yidhariRealUlt = cfg.yidhariContinuousEx === true
      && cfg.yidhariFinalizeEx !== true
    const ultForTime = yidhariRealUlt ? decibels[i] / cfg.ultimateCost : ultimateCount

    // 时间信道阻尼（迭代期）：她的实数次数经「必要时间→共享平A池→队友回能→队友整数次数」
    // 与队友耦合，队友整数次数在阈值处翻转会把她的次数拽成 2-循环（如 19.54↔19.71，队友 6↔7）。
    // 必要时间按 (prev+new)/2 松弛：不动点不变（不动点处 prev==new），2-循环振幅每迭代减半，
    // 两个种子收敛到同一中点 → 终局 floor 唯一。终局重推（finalize）不阻尼（直接按整数账本重算）。
    // agentId 判断冗余已删（同 yidhariRealUlt：yidhariContinuousEx 唯一写入方 = yidhari.ts:148）。
    const exForTime = cfg.yidhariContinuousEx === true
      && cfg.yidhariFinalizeEx !== true
      ? (prevStates[i].exSpecialCount + exSpecialCount) / 2
      : exSpecialCount

    // 连携次数 = 每次失衡连携次数 × 失衡次数（失衡次数由外部失衡池不动点收敛后传入 globalCfg.stunCount）
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * countStunOf(globalCfg)

    const necessary = exSpecialNecessaryTime(cfg, exForTime, ultForTime, prevStates[i])
      + ultForTime * cfg.ultimateActionTime
      + chainCount * cfg.chainActionTime
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime
      + (cfg.parryCount ?? 0) * cfg.assistFollowUpActionTime
      + ((cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)) * cfg.defensiveAssistActionTime
      // 反制支援（控制技整组化解）与弹刀同类：必做前台时间，账本必须预留（否则物化行顶出预算被截断）
      + Math.max(0, Math.floor(cfg.counterAssistCount ?? 0)) * (cfg.counterAssistActionTime ?? 0)
      + remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndActionTime
      // 诺姆膛温换连携赠链时间（目标槽）：装配后 applyNormaHatChain 追加的赠链行占前台，
      // 引擎必要时间必须预留（同连携 GROSS 全额口径），否则净占用顶出预算
      + (i === normaGiftTargetIdx ? normaGiftChainTime : 0)
      // 琉音好评转大赠链时间（目标槽，非轴）：装配后 applyLiuyinPromote 追加的赠大行占前台，
      // 引擎预留（GROSS 全额口径），平A池随之收缩守恒——不再依赖 post-hoc carve
      + (i === liuyinGiftTargetIdx ? liuyinGiftTime : 0)
      // 时间预算收敛：执行计划中模块专属动作行（如雅霜月架势、叶瞬光飞光）占用前台但未计入
      // estimateExSpecialTime → Σ执行行时间超战斗时间；外层循环把超出部分折入必要时间，压缩平A池。
      + (cfg.timeBudgetExcess ?? 0)
    totalNecessary.push(necessary)

    // 合轴时间 = 各招式合轴部分之和（展示/非操作回能通道用全额）
    const giftComboAlign = i === normaGiftTargetIdx
      ? normaGiftChainTime * cfg.chainComboAlignRatio
      : 0
    const comboAlignGeneric =
      ultForTime * cfg.ultimateActionTime * cfg.ultimateComboAlignRatio
      + chainCount * cfg.chainActionTime * cfg.chainComboAlignRatio
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime * cfg.dodgeCounterComboAlignRatio
      + (cfg.parryCount ?? 0) * cfg.assistFollowUpActionTime * cfg.assistFollowUpComboAlignRatio
      + ((cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)) * cfg.defensiveAssistActionTime * cfg.defensiveAssistComboAlignRatio
      + Math.max(0, Math.floor(cfg.counterAssistCount ?? 0)) * (cfg.counterAssistActionTime ?? 0) * (cfg.counterAssistComboAlignRatio ?? 0)
      + remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndActionTime * cfg.remielleRainbowEndComboAlignRatio
      + giftComboAlign
    comboAlignTimes.push(exSpecialComboAlignTime(cfg, exForTime, ultForTime, prevStates[i]) + comboAlignGeneric)
    // 预算抵扣部分：通用项全额可抵扣（necessary 按全额计），强特项按 GROSS/NET 约定
    comboAlignCredits.push(exSpecialComboAlignCredit(cfg, exForTime, ultForTime, prevStates[i]) + comboAlignGeneric)
  }

  // 总必做动作前台时间
  const sumNecessary = totalNecessary.reduce((a, b) => a + b, 0)
  // 合轴抵扣（团队级）：必做动作的合轴段与其他角色的动作并行，不占共享时间预算——
  // Σnecessary 允许 > 战斗时间（Σ>180），只要合轴抵扣后的净占用装得下。
  // 轴模式下栈引擎节省（axisOverlapByAction）与招式合轴率是同一物理并行的两种模型，
  // 按槽位取 max 不叠加（防同时设置时超扣；缺省合轴率全 0，退化为原口径）。
  // @fact engine:合轴预算抵扣 口径: 必做动作合轴段与其他角色动作并行、抵扣团队时间预算（Σnecessary 允许>战斗时间）；轴模式与栈引擎节省按槽取 max 不叠加；只抵扣含在 necessary 内的部分（GROSS 缺省，NET 模块照/卢西娅不重复抵） | 据 用户@2026-09-04·复核@2026-09-08 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/timeOccupation.ts#netFrontlineOccupation | 信 确认
  // @fact engine:单角色前线上限 口径: 单角色前台（必要+平A）≤ 战斗总时间——合轴抵扣放宽团队预算不放宽单人物理时间轴；贴顶截断的份额按剩余权重水填回流给还有余量的队友，不留池蒸发 | 据 用户@2026-09-05（改 09-04「留池不重分配」）·复核@2026-09-08 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/helpers.ts#iterate | 信 确认
  const overlapBySlot: number[] = configs.map(() => 0)
  let hasByAction = false
  for (const [key, sec] of Object.entries(globalCfg.axisOverlapByAction ?? {})) {
    const slot = Number(key.slice(0, key.indexOf(':')))
    const idx = configs.findIndex(c => c.slot === slot)
    if (idx >= 0 && Number.isFinite(sec)) {
      overlapBySlot[idx] += sec
      hasByAction = true
    }
  }
  const axisOverlapTotal = globalCfg.axisOverlapSeconds ?? 0
  const reliefSeconds = hasByAction
    ? comboAlignCredits.reduce((sum, credit, i) => sum + Math.max(credit, overlapBySlot[i]), 0)
    : Math.max(comboAlignCredits.reduce((a, b) => a + b, 0), axisOverlapTotal)
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
  // 验：src/core/__tests__/dynamicComboAlign.test.ts；轴模式不做（轴预设自带 axisOverlap 口径）。
  // **吸收上限**（v3，用户口径 2026-09-19「全部吸收比较难，默认队友的 40% 可以被吸收（合轴率），超过了就无力合轴了」）：
  // 每名非操作角色的容量 = `comboAlignAbsorbRatio` × 其净必要（缺省 0.4，全局变量、可调、0 = 不吸收）；
  // 吸收不完的溢出**不再**被队友兜住 ⇒ 回到封顶 / 装配截断——结构性溢出队（1431 簇）在自由口径下重新可见。
  // @fact engine:动态合轴吸收上限 口径: 非操作角色可被合轴吸收的前台 ≤ comboAlignAbsorbRatio × 其净必要前台（全局变量，缺省 0.4，0 = 不吸收）；吸收总量 = min(溢出, Σ容量)，超出部分照旧封顶/截断 | 据 用户@2026-09-19「全部吸收比较难…默认队友的40%可以被吸收（合轴率），超过了就无力合轴了」 | 验 src/core/__tests__/dynamicComboAlign.test.ts | 锚 src/core/resource/timeOccupation.ts#calcTimeAllocation | 信 确认
  // ⟳复核: 用户再调缺省比例或改为按角色/按招式的上限时，复核「吸收总量 == min(溢出, Σ 0.4×净必要)」恒等式（dynamicComboAlign.test ①）+ 1431 簇预设口径截断量（timeGolden over 字段）| 到期 2026-12-31
  const absorbRatioRaw = globalCfg.comboAlignAbsorbRatio ?? DEFAULT_COMBO_ALIGN_ABSORB_RATIO
  const absorbRatio = Number.isFinite(absorbRatioRaw) ? Math.min(1, Math.max(0, absorbRatioRaw)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
  const dynamicComboAlign: number[] = configs.map(() => 0)
  if (!axisMode && absorbRatio > 0 && sumNetNecessary > budget + 1e-9 && configs.length > 1) {
    let operator = 0
    for (let i = 1; i < netNecessary.length; i++) if (netNecessary[i] > netNecessary[operator]) operator = i
    // 上限按**封顶后的最终前台**算，不是按吸收前的净必要：吸收不完的溢出会让下方 feasibleScale 把「未被吸收的部分」等比压缩，
    // 而被吸收的部分不压 ⇒ 若按吸收前净必要取 40%，队友终态前台里被并行的份额会远超 40%（实测 auto-1431-1481-1491：
    // 1481 终态 67.8s 里 57.1s 被判并行 = 84%）。令 s = 封顶比例、r = 上限，则约束 dyn_i ≤ r·[(net_i − dyn_i)·s + dyn_i]
    // ⇔ dyn_i ≤ net_i · g(s)，g(s) = r·s / (1 − r + r·s)；s 又由吸收量决定（s = 预算 / (Σ净必要 − Σdyn)）⇒ 小不动点迭代
    // （g 单调递减、有下界，实测 ≤ 5 轮到 1e-9）。溢出 ≤ 容量时 s = 1、g = r，一轮即收敛，与无上限时的分摊公式逐位一致。
    const teammateNet = netNecessary.map((n, i) => (i === operator ? 0 : Math.max(0, n)))
    const teammateTotal = teammateNet.reduce((a, b) => a + b, 0)
    if (teammateTotal > 1e-9) {
      let g = absorbRatio
      let take = 0
      for (let it = 0; it < 8; it++) {
        take = Math.min(sumNetNecessary - budget, g * teammateTotal)
        const remain = sumNetNecessary - take
        const s = remain > budget ? budget / remain : 1
        const gNext = absorbRatio * s / (1 - absorbRatio + absorbRatio * s)
        if (Math.abs(gNext - g) < 1e-9) break
        g = gNext
      }
      for (let i = 0; i < teammateNet.length; i++) dynamicComboAlign[i] = teammateNet[i] / teammateTotal * take
    }
  }
  const dynamicTotal = dynamicComboAlign.reduce((a, b) => a + b, 0)
  const effectiveCredits = comboAlignCredits.map((c, i) => c + dynamicComboAlign[i])
  const absorbedNetNecessary = netNecessary.map((n, i) => Math.max(0, n - dynamicComboAlign[i]))
  const sumAbsorbedNet = absorbedNetNecessary.reduce((a, b) => a + b, 0)
  const reliefWithDynamic = reliefSeconds + dynamicTotal
  const rawScale = !axisMode && sumAbsorbedNet > budget && sumAbsorbedNet > 0
    ? budget / sumAbsorbedNet
    : 1
  const feasibleScale = rawScale
  // ⚠ 本封顶处的债务标记已于 2026-09-18（R24 批 1-3）**销号**——原标记称「本封顶让未实数化
  //   整数队的落点可随初值差 ±1 次强特（实测琉音 24/23）」，该量化依据经三条独立实测**证伪**：
  //   ① 批 1-0（`seedInvariance.test.ts` 第三档）104 预设 × 4 种子次数落点逐位相等；
  //   ② R24 手组队矩阵（8 个 `exSpecialCountFloor` 模块 × 3 组队友 × 11 种子 = 385 次）违反 0；
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
  const cappedNecessary = absorbedNetNecessary.map((x, i) =>
    x * feasibleScale + (effectiveCredits[i] ?? 0))
  const sumNecessaryCapped = cappedNecessary.reduce((a, b) => a + b, 0)
  // @fact engine:cfg/诊断量写回 口径: timeFeasibleScale 与 overflowSeconds 是引擎计算中途写回 globalCfg 的诊断量，在新克隆 cfg 上调用前恒为 undefined，严禁在调用前预读作条件判定；读截断秒数必须读 convergence.timeTruncatedSeconds | 据 用户@2026-09-18·R25-J2 | 验 src/composables/__tests__/seedInvariance.test.ts | 锚 src/core/resource/helpers.ts#iterate | 信 确认
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
    // 单角色前台硬顶：合轴抵扣放宽的是团队预算，单个角色自身时间轴仍受战斗总时长约束
    // （前台 = 必要 + 平A ≤ totalTime）。水填结果即该槽平A时间——贴顶截断的份额已在
    // 上面的轮次按剩余权重回流给还有余量的队友（不蒸发）。
    const basicAttackTime = basicAlloc[i]

    // 连携次数（与第一个循环保持一致）：每次失衡连携次数 × 失衡次数
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * countStunOf(globalCfg)

    const frontlineTime = necessary + basicAttackTime
    const backstageTime = Math.max(0, totalTime - frontlineTime)

    // 伊德海莉迭代期状态写入阻尼值（与必要时间信道同源）：原始实数次数经共享平A池与队友整数
    // 次数耦合会 2-循环（19.54↔19.71），状态与时间信道统一按 (prev+new)/2 松弛——不动点不变，
    // 2-循环振幅每迭代减半，两个种子收敛到同一中点，终局 floor 唯一。终局重推（finalize）写整数。
    // agentId 判断冗余已删（yidhariContinuousEx 唯一写入方 = src/mechanics/agents/yidhari.ts:148）。
    const storedEx = cfg.yidhariContinuousEx === true && cfg.yidhariFinalizeEx !== true
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
