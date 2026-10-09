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
import { frontlineRowSeconds } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { calcEnergySource, calcRawDecibelParts, calcDecibelSource } from './resourceIncome'
import { calcTimeAllocation } from './timeOccupation'
import { buildAnomalyEventExecutions } from './rowBuild'
import { calcCrossAgentEnergy } from './crossAgentEnergy'
import { truncateExecutionsToFrontline } from './timeTruncation'
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
    (cfg.decibelPerCurtainTrigger ?? 0) * curtainTriggers
    // 诺姆影画4·膛温换连携：诺姆+上一位队友各 +200 不可分享喧响（计入终结技次数）
    + giftDecibel,
    config.specialActionDecibelBonusPerSlot?.[i] ?? 0,
    config.anomalyDecibelBonusPerSlot?.[i] ?? 0,
    teammateFrontlineSeconds)
  // 物化钩子派发前的引擎行快照：供 buildResourceResult 复现钩子当时看到的行基准
  // （阶段1 第二刀——卢西娅 cap 等派生量不再经 cfg 回写传递）
  const preModuleExecutions: SkillExecution[] = []
  // CC-198：patchExecutions 派发前的行快照（额外强特行等只有 patch 钩子看得到）
  const prePatchExecutions: SkillExecution[] = []
  const builtExecutions = buildExecutionsWithPhase(cfg, state, chainCountTotal, teammateFrontlineSeconds, preModuleExecutions, prePatchExecutions)
  // 本槽赠送行时间（诺姆赠链 / 琉音赠大）：账本已含（necessary 预留），但行不在 builtExecutions 里
  // ——截断上限先扣掉它，装配后再追加的赠送行才与账本守恒（见上方 giftTimeOfSlot 注释）。
  const giftTimeThisSlot = giftTimeOfSlot(i)
  // ===== 时间线截断（通用资源循环规则，2026-09-05 用户口径）=====
  // 本槽物化行超出账本（必要 + 平A）的部分按时间线截断：平A行是填充项，先占位、永远保留；招式行整数装包
  // （按比例 floor + 小数降序加回，被砍行的回能 / 喧响 / 积蓄按保留比例缩，砍到 0 次的整行消失；见 timeTruncation.ts，
  // 不是从尾部整行丢）。iterate 已把必要时间
  // 封顶到「预算 − 队友占用」，所以这里的上限就是账本本身。语义 = 实战 180s 到点结算，
  // 资源攒多了也兑现不出来——旧实现没有这层，只能靠虚高账本挤平A池，结果两头都不准。
  //
  // ⚠ **合轴吸收已经在本上限里了**（R37-J5c 定性，2026-10-09 实测；**别再给本上限扣 credit**）：
  // `state.necessaryTime` 是 `helpers.ts#iterate` 的**净**账本 `cappedNecessary = absorbedNet × scale + credit`
  // ⇒ credit（含动态吸收）**已加回**，本上限不是「未扣 credit 的 gross」。全库实测恒等式：
  // `Σcut == Σ(netNecessary) − 预算 − Σdyn + 整数装包`，其中 `netNecessary = Σ[(nec−credit)/scale] + Σdyn`
  // 是**吸收前**净必要 —— 即截断砍的正是「吸收比 0.4 兜不住的残余溢出」，吸收**已经在截断之前生效**。
  // 该队（`auto-1431-1481-1491`，全库唯一 cut > 1s）实测：ratio 0 / 0.4 / 0.7 / 1 ⇒
  // cut 34.25 / 19.80 / 0.00 / 0.00、伤害 98.73 / 104.68 / 124.39 / 124.89M（单调、非零收益）。
  // 反证（两条都实测红 `comboAbsorbBeforeTruncation.test.ts`）：① 本上限再减 `comboAlignCredit`
  // ⇒ 16 支新截断队 + 本队 cut 反涨 19.80→30.75（credit 是**团队**预算抵扣、含队友被吸收的量，
  // 与本槽物理时间轴无关，硬塞进本槽会改 iterate 收敛不动点 ⇒ 自锁到更糟吸引子）；
  // ② 把上限按「队友让出的秒数」放宽 ⇒ 净占用 209.43 > 预算 180（破超时判定硬不变量）。
  // @fact engine:时间线截断/合轴吸收位置 口径: 动态合轴吸收在截断**之前**生效（用户裁决「截断需要在吸收之后…合轴不能被截断成 0 收益」）——实现 = `iterate` 的净账本 `necessaryTime`（= absorbedNet×scale + credit）就是本上限，**不得**再对本上限扣 comboAlignCredit（那是团队预算抵扣、含队友量，扣了会自锁出 16 支新截断队）；吸收比缺省 0.4 兜不住的残余溢出被截断属设计内行为，消截断的杠杆是机制参数 comboAlignAbsorbRatio（该队 ratio≥0.7 时 cut=0），不是改本上限 | 据 用户@2026-10-09「截断需要在吸收之后，队友已经合轴让出了前台时间…如果还是被截断，那么合轴就是 0 收益，不正常」·实测@2026-10-09（全库 97 队恒等式 + ratio sweep） | 验 src/core/__tests__/comboAbsorbBeforeTruncation.test.ts | 锚 src/core/resource/assembleSlot.ts#assembleSlot + src/core/resource/helpers.ts#iterate | 信 确认
  // ⟳复核: 截断上限口径、`cappedNecessary` 算式或 `comboAlignAbsorbRatio` 缺省再动时，复核「全库 cut > 1s 的队仍只有 auto-1431-1481-1491」+「ratio 0→0.4→1 单调且伤害递增」 | 到期 2027-03-31
  const truncated = truncateExecutionsToFrontline(
    builtExecutions, Math.max(0, state.necessaryTime + state.basicAttackTime - giftTimeThisSlot))
  // 赠行由**引擎**物化（阶段1 ②）：仍追加在截断之后（永不被截），截断上限仍先扣赠行时间
  const giftRowsHere: SkillExecution[] = []
  if (i === ultimateGiftRow.targetIdx && ultimateGiftRow.count > 0) {
    giftRowsHere.push(buildGiftRow({
      moveId: cfg.ultimateMoveId,
      moveName: '好评转大·队友终结技',
      count: ultimateGiftRow.count,
      actionTime: cfg.ultimateActionTime,
      skillDamageTarget: 'ultimate',
      skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
    }))
  }
  if (i === chainGiftRow.targetIdx && chainGiftRow.count > 0) {
    giftRowsHere.push(buildGiftRow({
      moveId: cfg.chainMoveId,
      moveName: '诺姆膛温替换·队友连携技',
      count: chainGiftRow.count,
      actionTime: cfg.chainActionTime,
      comboAlignRatio: cfg.chainComboAlignRatio,
      skillTableNote: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）',
      chainGift: true,
    }))
  }
  const executions = giftRowsHere.length > 0 ? [...truncated.executions, ...giftRowsHere] : truncated.executions
  // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（`frontlineRowSeconds`；后台行不占共享轴，如莱卡恩围猎蓄力；
  // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
  // 赠送行（诺姆赠链 / 琉音赠大）的占位行已在 `executions` 里（上方物化），故这里不再加 giftTimeThisSlot（否则双计）。
  // 装配之后编排层（`applyUltimatePromote` / `applyChainGift`）还会按池口径改写或撤掉占位行（轴模式另有 post-hoc carve），
  // 所以展示层由 `normalizeDisplayTime` 按最终行再算一次——同一个 `frontlineRowSeconds`，新增赠送机制不必各自回扣。
  const execFrontlineTime = frontlineRowSeconds(executions)
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
    prePatchExecutions,
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
      kept: truncated.keptSeconds,
      cutSeconds: truncated.cutSeconds,
    } : null,
  }
}
