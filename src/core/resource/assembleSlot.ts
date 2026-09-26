/**
 * S4 装配 + 可行化截断 —— 自 `core/resource.ts#calcTeamResources` 的 `runTailPipeline` 外提
 * （CC-5b，2026-09-25）。
 *
 * 职责：逐槽把 `states` + `cfg` 装配成 `CharacterResourceResult`（行/资源/时间），并做时间线截断
 * （`truncateExecutionsToFrontline`：平A行不参与截断、后台行不占前台、整数装包、
 * `overflowSeconds`/`truncationCuts` 逐行上报）。同时把跨槽派生量写回 cfg
 * （模块能力 `onFinalAssemble`：外部回血按提供者终结技次数折算、卢西娅 C4 帷幕三写回
 * `luciaCurtainTriggerCount`/`SelfCount`/`Teammates`）——**槽序即写序**，装配段不可重排。
 *
 * 与旧闭包的差别**只有机械替换**：闭包捕获的外层变量改经 `ctx` 解构读取，函数体逐字保留原
 * 表达式、顺序、常量与注释。累加器（`timeTruncatedSeconds` / `truncationCuts` /
 * `truncationBySlot`）仍留在 `resource.ts` 的 `configs.map` wrapper（本文件只返回单槽产物）。
 *
 * 依赖方向：本文件**不得** import `core/resource.ts`（防循环依赖）；只依赖类型、`@/mechanics`、
 * `./helpers`、`./giftRows`、`./phaseExecutions`、`./crossAgentSupply` 与 `./curtain` 的类型。
 */
import type {
  ResourceCalcConfig, CharacterOperationConfig, IterationState, SkillExecution,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'
import {
  calcEnergySource, calcRawDecibelParts, calcDecibelSource, calcTimeAllocation,
  buildAnomalyEventExecutions, calcCrossAgentEnergy, truncateExecutionsToFrontline,
} from './helpers'
import { buildGiftRow } from './giftRows'
import { buildExecutionsWithPhase } from './phaseExecutions'
import { giftDecibelForCfg, findCrossAgentSupplySlots } from './crossAgentSupply'
import type { CurtainInfo } from './curtain'

/** 装配段的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface AssembleSlotContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  totalTime: number
  /** 装配期终态（`runTailPipeline` 在此之前已完成全部 states 重绑定） */
  states: IterationState[]
  curtain: CurtainInfo
  giftTimeOfSlot: (idx: number) => number
  chainGiftRow: { targetIdx: number; count: number }
  ultimateGiftRow: { targetIdx: number; count: number }
}

/**
 * 装配单个槽位（#8 分刀自逐槽 `configs.map` 抽出，2026-09-12；CC-5b 外提，2026-09-25）。
 * 返回类型由 TS 推断（与原闭包一致）：`{ result, cutSeconds, cuts, bySlotEntry }`。
 */
export function assembleSlot(ctx: AssembleSlotContext, cfg: CharacterOperationConfig, i: number) {
  const { configs, config, totalTime, states, curtain, giftTimeOfSlot, chainGiftRow, ultimateGiftRow } = ctx
  const curtainTriggers = curtain.triggers
  const state = states[i]
  const chainCountTotal = state.chainCountTotal

  // 装配期写回：依赖帷幕提供者**最终**终结技次数的派生量由模块能力写回本槽 cfg（供喧响/展示共用精确值；
  // 当前实现 = 外部回血按提供者终结技次数折算 + 卢西娅 C4 帷幕三写回）。回血源复用帷幕提供者槽
  // （2026-09-25 CC-6b，lead 裁决 §6-2；前提写死在 `./curtain.ts` 头注释）。2026-09-26 CC-14c：
  // 原 `i === <按角色字段找的槽>` 判据与写回算式迁进模块能力 `onFinalAssemble`（规则 6），调用点
  // 位置不变（槽序即写序）。2026-09-26 CC-14e：卢西娅 C4 帷幕三写回（`luciaCurtain*`）并入同一调用点
  // ——`curtainOpeners` 由引擎按 `curtain-open` 跨槽供给收集原始次数后传入，模块内自调 `curtainTriggers`。
  if (curtain.providerSlot >= 0) {
    const curtainOpeners = findCrossAgentSupplySlots(configs, 'curtain-open')
      .map(s => ({
        agentId: configs[s]?.agentId ?? '',
        rawCount: Math.max(0, Math.floor(states[s]?.ultimateCount ?? 0)),
      }))
      .filter(m => m.rawCount > 0)
    getAgentMechanic(cfg.agentId)?.onFinalAssemble?.({
      cfg,
      providerUltCount: states[curtain.providerSlot]?.ultimateCount ?? 0,
      isCurtainProvider: i === curtain.providerSlot,
      curtainTriggers,
      state,
      totalTime,
      curtainOpeners,
    })
  }

  // Σ 队友前台秒（行级能量/喧响与装配 buildExecutions 同语义：不含自己）
  const teammateFrontlineSeconds = configs.reduce(
    (sum, _, j) => (j === i ? sum : sum + states[j].frontlineTime),
    0,
  )

  // 能量源 = iterate 驱动次数的快照（2026-09-03：展示与驱动同源，Δ 恒 0——
  // 曾各算各的：iterate 用上轮态、装配重算当前态，雅/莱卡恩 Δ=+55.5）。
  // 快照缺失（历史状态/热启动）才回退重算 + 跨角色回补。
  const energySrc = state.energySource
    ? { ...state.energySource }
    : calcEnergySource(cfg, state, configs, config.shieldCount, config.energyShieldCount, chainCountTotal, config.totalTime, teammateFrontlineSeconds)
  if (!state.energySource) {
    const crossAgent = calcCrossAgentEnergy(i, configs, states)
    energySrc.crossAgent = crossAgent
    energySrc.supportUltimateRegen = crossAgent.supportUltimateRegen
    energySrc.total += crossAgent.total
  }


  // 喧响伴随
  let teammateShare = 0
  for (let j = 0; j < configs.length; j++) {
    if (j === i) continue
    const otherCfg = configs[j]
    const otherChainCountTotal = states[j].chainCountTotal
    // 行级喧响 Σ：j 视角的队友前台秒（Σ k≠j，与装配层 buildExecutions 传参同语义）
    const otherTeamFrontline = configs.reduce((sum, _, k) => (k === j ? sum : sum + states[k].frontlineTime), 0)
    const otherShareable = calcRawDecibelParts(otherCfg, states[j], otherChainCountTotal, states[j].exSpecialCount, states[j].ultimateCount, totalTime, otherTeamFrontline).shareableTotal
    teammateShare += otherShareable * otherCfg.decibelShareRatio
  }

  // 诺姆影画4·膛温换连携喧响：`giftDecibelForCfg` 已含 `decibelPerUnit × count`
  // （400 = 诺姆+上一位队友两侧合计，门控在模块内判），引擎**不再**自己乘系数。
  const giftDecibel = giftDecibelForCfg(configs, states, cfg, totalTime)

  const decibelSrc = calcDecibelSource(cfg, state, teammateShare, chainCountTotal, totalTime,
    (cfg.luciaC4DecibelPerTrigger ?? 0) * curtainTriggers
    // 诺姆影画4·膛温换连携：诺姆+上一位队友各 +200 不可分享喧响（计入终结技次数）
    + giftDecibel,
    config.specialActionDecibelBonusPerSlot?.[i] ?? 0,
    config.anomalyDecibelBonusPerSlot?.[i] ?? 0,
    teammateFrontlineSeconds)
  // 物化钩子派发前的引擎行快照：供 buildResourceResult 复现钩子当时看到的行基准
  // （阶段1 第二刀——卢西娅 cap 等派生量不再经 cfg 回写传递）
  const preModuleExecutions: SkillExecution[] = []
  const builtExecutions = buildExecutionsWithPhase(cfg, state, chainCountTotal, teammateFrontlineSeconds, preModuleExecutions)
  // 本槽赠送行时间（诺姆赠链 / 琉音赠大）：账本已含（necessary 预留），但行不在 builtExecutions 里
  // ——截断上限先扣掉它，装配后再追加的赠送行才与账本守恒（见上方 giftTimeOfSlot 注释）。
  const giftTimeThisSlot = giftTimeOfSlot(i)
  // ===== 时间线截断（通用资源循环规则，2026-09-05 用户口径）=====
  // 本槽物化行超出账本（必要 + 平A）的部分按时间线尾部截断：平A行是填充项永远保留，
  // 招式行从后往前整行丢、边界行等比缩（伤害/失衡/积蓄/回能线性缩）。iterate 已把必要时间
  // 封顶到「预算 − 队友占用」，所以这里的上限就是账本本身。语义 = 实战 180s 到点结算，
  // 资源攒多了也兑现不出来——旧实现没有这层，只能靠虚高账本挤平A池，结果两头都不准。
  const truncated = truncateExecutionsToFrontline(
    builtExecutions, Math.max(0, state.necessaryTime + state.basicAttackTime - giftTimeThisSlot))
  // 赠行由**引擎**物化（阶段1 ②）：仍追加在截断之后（永不被截），截断上限仍先扣赠行时间
  const giftRowsHere: SkillExecution[] = []
  if (i === ultimateGiftRow.targetIdx && ultimateGiftRow.count > 0) {
    giftRowsHere.push(buildGiftRow({
      moveId: cfg.ultimateMoveId,
      moveName: '好评转大·队友终结技',
      count: ultimateGiftRow.count,
      actionTime: cfg.ultimateActionTime ?? 0,
      skillDamageTarget: 'ultimate',
      skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
    }))
  }
  if (i === chainGiftRow.targetIdx && chainGiftRow.count > 0) {
    giftRowsHere.push(buildGiftRow({
      moveId: cfg.chainMoveId,
      moveName: '诺姆膛温替换·队友连携技',
      count: chainGiftRow.count,
      actionTime: cfg.chainActionTime ?? 0,
      comboAlignRatio: cfg.chainComboAlignRatio ?? 0,
      skillTableNote: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）',
      chainGift: true,
    }))
  }
  const executions = giftRowsHere.length > 0 ? [...truncated.executions, ...giftRowsHere] : truncated.executions
  // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（后台行不占共享轴，如莱卡恩围猎蓄力；
  // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
  // 装配后追加的赠送行（诺姆赠链/琉音赠大）不在 Σ行里——展示层由 `normalizeDisplayTime`
  // 在编排层按最终行统一重算（单一口径，新增赠送机制不必各自回扣）。
  // 赠行已在 `executions` 里（上方物化），故这里不再加 giftTimeThisSlot（否则双计）
  const execFrontlineTime = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
  const timeAlloc = {
    ...calcTimeAllocation(cfg, state, totalTime),
    frontlineTime: execFrontlineTime,
    backstageTime: Math.max(0, totalTime - execFrontlineTime),
  }
  const anomalyEventExecutions = buildAnomalyEventExecutions(cfg, state, totalTime)
  const mechanicResult = getAgentMechanic(cfg.agentId)?.buildResourceResult?.({
    cfg,
    state,
    teamFrontlineSeconds: teammateFrontlineSeconds,
    preModuleExecutions,
  }) ?? {}

  const result = {
    slot: cfg.slot,
    agentId: cfg.agentId,
    agentName: cfg.agentId, // 名称由上层填充
    isFlashUser: cfg.isFlashUser,
    timeAllocation: timeAlloc,
    energySource: energySrc,
    // 真正驱动 exSpecialCount 的收敛后总能量（iterate 末轮 totalEnergy）
    derivedEnergy: state.totalEnergy,
    exSpecialCount: state.exSpecialCount,
    exSpecialMoveId: cfg.exSpecialMoveId,
    exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
    decibelSource: decibelSrc,
    ultimateCost: cfg.ultimateCost,
    ultimateCount: state.ultimateCount,
    chainCountPerStun: cfg.chainCountPerStun,
    chainCountTotal,
    executions,
    anomalyEventExecutions,
    totalStunBuildUp: 0, // 后续由 damage.ts 补充
    ...mechanicResult,
  }
  return {
    result,
    cutSeconds: truncated.cutSeconds,
    // 守卫原样：cut 非空才记 cuts/账（与抽取前 push 条件一致）
    cuts: truncated.cuts.length > 0 ? truncated.cuts.map(c => ({ slot: cfg.slot, ...c })) : [],
    bySlotEntry: truncated.cuts.length > 0 ? {
      slot: cfg.slot,
      requested: truncated.usedSeconds,
      kept: Math.max(0, truncated.usedSeconds - truncated.cutSeconds),
      cutSeconds: truncated.cutSeconds,
    } : null,
  }
}
