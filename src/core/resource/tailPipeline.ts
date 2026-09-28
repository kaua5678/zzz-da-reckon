/**
 * S3–S4 尾段管线 —— 自 `core/resource.ts#calcTeamResources` 的 `runTailPipeline` 闭包外提
 * （CC-5c，2026-09-25）。
 *
 * 职责：末轮欠打回填（`runUnderfillProbe`）→ 伊德海莉 tail 终局整数重推（`runFinalizePasses`，
 * `stage='tail'`）→ 帷幕 / 赠链 / 赠大折算 → S4 装配
 * （`assembleSlot` 逐槽累加）。顺序不可交换：**tail 终推 → 热启动落缓存 → 帷幕/赠链** 是
 * `@fact engine:热启动逐位透明` 的前提，搬迁不得重排。
 *
 * 与外层闭包的通信面 = `states`（入 `from` / 出 `states`）+ `diag` + `TailPipelineContext`
 * （configs/config/totalTime/probeCtx）。函数**不** import
 * `core/resource.ts`（防循环依赖），也不重绑定 `calcTeamResources` 的外层变量——重绑定由
 * `resource.ts` 的保语义包装完成（重折环的 `accepted.states` 快照 / 拒绝还原依赖它）。
 *
 * 依赖方向：本文件不得 import `core/resource.ts`；只依赖类型与引擎子模块
 * （`./underfillProbe` / `./finalizePasses` / `./assembleSlot` /
 * `./crossAgentSupply` / `./curtain` / `./helpers`）。
 */
import { stunCountForCountChannel } from '@/core/stunPlanProjection'
import type {
  ResourceCalcConfig, CharacterOperationConfig, CharacterResourceResult,
  IterationState, TruncationCut,
} from '@/types/resource'
import { crossAgentSupplyAt, crossAgentSuppliesOf, findCrossAgentSupplySlots, ultimateGiftOf } from './crossAgentSupply'
import { curtainInfoOf } from './curtain'
import { runFinalizePasses } from './finalizePasses'
import { runUnderfillProbe, type UnderfillProbeContext } from './underfillProbe'
import { iterate } from './helpers'
import { assembleSlot, type AssembleSlotContext } from './assembleSlot'
import type { SolveDiagnostics } from './solveDiagnostics'

/** 尾段管线的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface TailPipelineContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  totalTime: number
  probeCtx: UnderfillProbeContext
}

/** 尾段管线产物：原闭包返回对象逐字段保留（`characters` / 截断账 / 赠行时间）。 */
export interface TailResult {
  characters: CharacterResourceResult[]
  timeTruncatedSeconds: number
  truncationCuts: TruncationCut[]
  truncationBySlot: { slot: number; requested: number; kept: number; cutSeconds: number }[]
  inputStunCount: number
  chainGiftTime: number
  ultimateGiftTime: number
}

/**
 * 赠行**物化口径**（阶段1 ②，2026-09-10）：行由引擎产出（存在/次数单一事实源），倍率由编排层补。
 *
 * 下面两个薄包装只是把「账本口径」（`crossAgentSupplyAt`，带秒数）转成「行口径」（带次数），
 * 并统一按 `config.teamSize`（编排层队长）解析目标槽——与账本口径 `configs.length` 解耦。
 */
function chainGiftRowSpec(
  configs: CharacterOperationConfig[], states: IterationState[], totalTime: number, teamSize: number | undefined,
): { targetIdx: number; count: number } {
  const [info] = crossAgentSuppliesOf(configs, states, 'gift-chain:chain', {
    totalTime, stunCount: 0, teamSize, axisMode: false,
  })
  return !info || info.count <= 0 || !configs[info.targetIdx]
    ? { targetIdx: -1, count: 0 }
    : { targetIdx: info.targetIdx, count: info.count }
}

/** 行口径的琉音赠大（含次数）：轴模式用轴预设计数，非轴用模块供给；目标槽按 `teamSize` 解析 */
function ultimateGiftRowSpec(
  configs: CharacterOperationConfig[], states: IterationState[], totalTime: number, stunCount: number,
  axisPromote: { targetSlot: number; count: number } | undefined, axisMode: boolean, teamSize: number | undefined,
): { targetIdx: number; count: number } {
  // 轴模式：次数由轴预设 `promoteVariant` 块决定（模块供给被 axisSuppressed 跳过），预设计数优先
  if (axisMode && axisPromote && axisPromote.count > 0) {
    return configs[axisPromote.targetSlot] ? { targetIdx: axisPromote.targetSlot, count: axisPromote.count } : { targetIdx: -1, count: 0 }
  }
  const [info] = crossAgentSuppliesOf(configs, states, 'gift-chain:ultimate', {
    totalTime, stunCount, teamSize, axisMode,
  })
  return !info || info.count <= 0 || !configs[info.targetIdx]
    ? { targetIdx: -1, count: 0 }
    : { targetIdx: info.targetIdx, count: info.count }
}


/**
 * S3–S4 尾段管线（R37-J2 步骤 ① 函数化 2026-09-19；CC-5c 外提 2026-09-25，零行为搬迁）。
 * 函数体 = 原 `runTailPipeline` 闭包逐字保留（缩进不变），只在头尾做机械替换：
 * `let states = from` + 解构 `ctx`，末尾把返回对象包成 `{ states, tail }`。
 */
export function runTailPipeline(
  ctx: TailPipelineContext,
  diag: SolveDiagnostics,
  from: IterationState[],
): { states: IterationState[]; tail: TailResult } {
  let states = from
  const { configs, config, totalTime, probeCtx } = ctx
  // ===== 末轮欠打回填（可行性门控，2026-09-05）=====
  // 实现已迁 `src/core/resource/underfillProbe.ts#runUnderfillProbe`（CC-5a，2026-09-25，纯函数；
  // 详细口径与否决记录随实现搬去该文件头 JSDoc）。此处只注入只读 ctx 并**每次调用时读 `diag`**
  // （重折环会换新对象，禁止 `const d = diag` 缓存）；门槛常量经 `probeCtx` 注入（声明与 `@fact`
  // 锚留在本文件）。
  states = runUnderfillProbe(probeCtx, diag, states)

  // 失衡次数由外部失衡池不动点收敛后传入（连携次数 = chainCountPerStun × stunCount，见 iterate）
  const inputStunCount = config.stunCount ?? 0

  // 伊德海莉终局整数重推（targeted 连续松弛收尾，2026-09-04；规则 6 引擎落点，2026-09-25 CC-6c）：
  // 迭代期她的强特次数以实数参与收敛（refund 反馈解析求解 → 唯一不动点，消除 19/20 双稳态），
  // 终局 floor 一次 + 整数态重推 ≤12 轮到全状态逐位稳定，让时间预算/能量/喧响账本与整数次数自洽。
  // 角色专属部分（`stage='tail'` / 置哪个旗标）已迁 yidhari 模块的 `finalizePass` 能力，本处只调
  // 通用执行器（引擎不写 agentId、不 import 角色模块）。stage='tail' = 欠打回填之后、装配之前，
  // **不可与 preTail 合并**（合并会改数值）。
  // 终局重推要求全状态逐位稳定：她的次数已是整数，队友（如莱卡恩实数次数）在整数池下
  // 是整数输入的确定性函数——逐位相等才是 determinism.test（伤害逐位一致）的判据；
  // 只比次数会用 ε 外的平A时间残差破坏逐位一致。
  // 旗标复位移到装配之后（2026-09-09，与 billyFinalizeChain 同款）：装配行必须仍按终局语义
  // floor（yidhari 蓄力 cycles 迭代期实数松弛后，装配期靠本旗标取整数行），复位只服务于
  // 「cfg 被外层不动点/热启动复用，下轮调用回到实数迭代期」。
  // 实数迭代期的 2-循环（次数↔喧响↔终结技阈值）被终局整数重推吸收：重推稳定的整数态
  // 就是终局不动点，收敛标志按重推结果报（重推 ≤3 轮未稳 = 不谎报收敛）。
  {
    const fp = runFinalizePasses(configs, states, 'tail', iterate, config)
    states = fp.states
    if (fp.converged) diag.converged = true
  }

  // 收敛后按最终状态折算跨角色联动：卢西娅4命帷幕触发次数（含伊德海莉大招开帷幕）、回血按卢西娅大招次数
  // 2026-09-25 CC-6b：整块迁进引擎能力/跨槽供给（规则 6）——提供者按模块能力
  // `getAgentMechanic(cfg.agentId)?.curtainTriggers` 找槽（与 `luciaCinemaLevel` 是否在场无关，
  // 该字段写在编排层另一份 cfg 上的旧顾虑随之消失），队友开帷幕量按 `curtain-open` 收集成标量
  // （外部回血写回自 2026-09-26 CC-14c 起由模块能力 `onFinalAssemble` 在装配段完成，不再按角色字段找槽）。
  const curtain = curtainInfoOf(configs, states, totalTime)

  // 构建最终结果
  /**
   * 赠送行时间（诺姆膛温赠链 / 琉音好评转大赠大）：由 `applyChainGift` / `applyUltimatePromote`
   * 在装配**之后**追加到目标槽执行计划，不在 `buildExecutions` 产物里；其时间已由 iterate 计入
   * 目标槽必要时间（GROSS 全额，见 helpers.ts Step4 两处预留）。**截断上限与前台展示必须同口径计入**，
   * 否则：① 其它行按「含赠送时间的账本」截断、再叠加赠送行 → 物化行超账本（守恒破）；
   * ② 资源卡「总计」= 战斗时间 + 赠送秒数（用户实测 2026-09-08：诺姆入队后主C 180s + 诺姆连携秒数）。
   * 轴模式同样计入（次数走 `ultimateGiftOf` 的轴分支，见下方；旧注释「轴模式不预留」已作废）。
   */
  const chainGiftFinal = crossAgentSupplyAt(configs, states, findCrossAgentSupplySlots(configs, 'gift-chain:chain')[0] ?? -1, {
    totalTime, stunCount: stunCountForCountChannel(config), teamSize: config.teamSize,
  })
  /**
   * 琉音赠大（装配侧：**截断上限 + 前台展示 + 赠行时间预留**）——四处同源之一（单一事实源 =
   * `ultimateGiftOf`，见 `@fact engine:赠送时间/轴模式四处同源`）。
   *
   * ⚠ **2026-09-20 轴模式改为计入**（用户口径「同一个量转大次数，在轴模式下显示制定了部分好评值的
   * 用途，剩余好评应该默认 90……所以转大次数应该很明确」）：
   *
   * 旧口径「轴模式不预留」（2026-09-10 为避数值重排暂时维持）的代价 = **双重计费**：模块的
   * `axisSuppressed` 让非轴分支恒返回 count 0，而本处（截断上限）扣掉了轴赠大、`iterate` 账本与
   * S2 折叠环测量却都没涨 ⇒ 截断额度凭空少 8.732s（雨果 0 命轴），决算行被整数装包砍掉一整次
   * （5→4，实测 `hugoVerdictLanding`/`stunVulnSummary` 案例 B/D 红）。
   *
   * 现改为一律走 `ultimateGiftOf`（轴模式用 `axisUltimatePromote.count`——编排层已按「轴声明 60 +
   * 剩余好评默认 90」算好，与 `promoteFixpoint` 同源）⇒ 预留 == 赠行 == 截断扣除，守恒恢复，
   * `applyUltimatePromote` 也不再需要 post-hoc carve（`ultimateGiftTimeReserved` 有值即走预留路径）。
   */
  const ultimateGiftFinal = ultimateGiftOf(configs, states, {
    totalTime, stunCount: stunCountForCountChannel(config), teamSize: config.teamSize,
    axisMode: config.axisMode, axisPromote: config.axisUltimatePromote,
  })
  const giftTimeOfSlot = (idx: number): number =>
    (idx === chainGiftFinal.targetIdx ? chainGiftFinal.time : 0)
    + (idx === ultimateGiftFinal.targetIdx ? ultimateGiftFinal.time : 0)
  // 赠行**物化口径**（阶段1 ②，2026-09-10）：行由引擎产出（存在/次数单一事实源），倍率由编排层补。
  // 目标槽按 `config.teamSize`（编排层队长）解析——与账本口径 `configs.length` 解耦，见 giftRowTargetSlot。
  const chainGiftRow = chainGiftRowSpec(configs, states, totalTime, config.teamSize)
  const ultimateGiftRow = ultimateGiftRowSpec(
    configs, states, totalTime, stunCountForCountChannel(config),
    config.axisUltimatePromote, !!config.axisMode, config.teamSize,
  )
  // S4 装配（CC-5b 外提至 `./resource/assembleSlot.ts`，纯函数）的只读上下文：闭包捕获的
  // `states`（装配期终态）/ `curtain` / 赠行查询函数与行口径在此显式化。
  const slotCtx: AssembleSlotContext = {
    configs, config, totalTime, states, curtain, giftTimeOfSlot, chainGiftRow, ultimateGiftRow,
  }
  /** 时间线截断总量（装配阶段砍掉的秒数）：= 资源允许但时间装不下的部分，上报为 overflowSeconds */
  let timeTruncatedSeconds = 0
  /** 逐行截断明细（团队级汇总，Σ cutSeconds == timeTruncatedSeconds）：资源池清单 + 难度轴交互缩放 */
  const truncationCuts: TruncationCut[] = []
  /** 各槽截断秒数账（requested/kept/cutSeconds）：存活率 = kept/requested，难度轴按它缩交互次数 */
  const truncationBySlot: { slot: number; requested: number; kept: number; cutSeconds: number }[] = []
  // ===== S4 装配段（#8 分刀 2026-09-12；CC-5b 2026-09-25 外提 `./resource/assembleSlot.ts#assembleSlot`）=====
  // 逐槽装配闭包已搬为纯函数；本处只保留累加器与 `configs.map` wrapper：累加（timeTruncatedSeconds /
  // truncationCuts / truncationBySlot）与 cfg 写回的**每槽执行顺序**、`cuts 非空才 push` 的条件守卫
  // 原样保持；判据 = timeGolden / timeFillRatchet delta 0（规则 10）。
  const characters: CharacterResourceResult[] = configs.map((cfg, i) => {
    const s = assembleSlot(slotCtx, cfg, i)
    timeTruncatedSeconds += s.cutSeconds
    for (const c of s.cuts) truncationCuts.push(c)
    if (s.bySlotEntry) truncationBySlot.push(s.bySlotEntry)
    return s.result
  })
  return {
    states,
    tail: {
      characters, timeTruncatedSeconds, truncationCuts, truncationBySlot, inputStunCount,
      chainGiftTime: chainGiftFinal.time, ultimateGiftTime: ultimateGiftFinal.time,
    },
  }
}
