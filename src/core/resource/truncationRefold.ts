/**
 * 债 2 批 2-1：截断外环回灌（rowTimeLimit 重折环）—— 自 `core/resource.ts#calcTeamResources`
 * 的重折环闭包外提（CC-5d，2026-09-25，零行为搬迁）。
 *
 * 病灶：S1 迭代按**未截断行**计回能/喧响 ⇒ 强特/终结次数被 180s 装不下的行推高 ⇒ 招式行塞爆前台被 S4 截断 ⇒
 * 账本 > 展示层（般+诺+卢实测槽0 回能账本 200 vs 截断后行 Σ 140）。修法（用户 2026-09-11 给定语义「装不下就重收敛」）：
 * 初装截断 > 容差时，把每槽装配 kept（招式行真兑现的秒数）作为 cfg.rowTimeLimit 注入，回到 S2 入口重跑
 * 折叠 → 比利终推 → 尾段（欠打回填 → 伊德海莉终推 → 装配）；账本收入经 feasibleRows 只数装得下的行。
 * 接受判据 = Σcut **不增**（≤ 上次 + 1e-6；相等也接受——那正是「账本按真装得下的行计」的不动点态）；变大则整体回滚到
 * 上一次接受态并停。停机 = 本轮 kept 与上一轮写入的 rowTimeLimit 逐槽一致（|Δ| ≤ 1e-3，账本 == 展示层，无需再跑）或 3 轮用尽。
 * 默认路径（cut ≤ 1s 的队，刀 1 后 103/105 预设）：零分支零写入 ⇒ 逐位 0 delta；结构性溢出（必要行本身 > 预算，1431 簇）
 * 若一轮后 cut 不降 ⇒ 回滚初装态、如实上报（overflowSeconds / truncationCuts），交给外层降配 / 逐模块退化。
 * ⚠ 三条纪律：① cfg 对象保持同一性（闭包/外层不动点持有引用）⇒ 还原用「清键 + assign」；② rowTimeLimit 返回前恒删除
 *   （cfg 被外层不动点/热启动复用，WARM_KEY_OMIT_CFG 也已排除）；③ 函数级诊断量随每次重跑归零，报告的是被接受那一跑的读数。
 *
 * 与外层的通信面 = `states`（入 `init.states` / 出返回值）+ `diag`（换新对象 = 归零）+ `ctx`；「从 S2 入口重跑」
 * 三步（fold → preTail 终推 → 尾段）经 `rerun` 回调注入，本文件**不** import `core/resource.ts`（防循环依赖）。
 */
import type {
  ResourceCalcConfig, CharacterOperationConfig, IterationState,
} from '@/types/resource'
import { createSolveDiagnostics, type SolveDiagnostics } from './solveDiagnostics'
import type { TailResult } from './tailPipeline'

/** 重折环的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface TruncationRefoldContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  /** resource.ts 的 s2EntryCfgs（入口态浅拷贝；还原用「清键 + assign」保 cfg 对象同一性） */
  s2EntryCfgs: CharacterOperationConfig[]
  /** S2 入口规范种子（每轮重跑前 map 浅拷贝） */
  s2EntrySeedStates: IterationState[]
  /** = TIME_BUDGET_TOLERANCE_SECONDS（常量带 @fact，留 resource.ts 注入） */
  toleranceSeconds: number
  /** 从 S2 入口重跑到装配：调用方把外层 diag 换成传入的 d，再跑 fold → preTail 终推 → 尾段；返回重跑后的 states 与 tail */
  rerun: (d: SolveDiagnostics, seed: IterationState[]) => { states: IterationState[]; tail: TailResult }
}

/** 重折环产物：states/diag/tail 供 resource.ts 写回外层；passes/rejected 进收敛读数。 */
export interface TruncationRefoldResult {
  states: IterationState[]
  diag: SolveDiagnostics
  tail: TailResult
  passes: number
  rejected: boolean
}

/** 折叠环轮数上限（算力护栏；原 `resource.ts` 模块级 const，逐字搬）。 */
const ROW_REFOLD_MAX_PASSES = 3

/**
 * 截断重折环：函数体 = 原 `resource.ts:317–394` 逐字保留，只在头尾做机械替换
 * （`let { states, diag, tail } = init`；`resetDiagnostics()` + 三步重跑 → `ctx.rerun(...)`）。
 */
export function runTruncationRefold(
  ctx: TruncationRefoldContext,
  init: { states: IterationState[]; diag: SolveDiagnostics; tail: TailResult },
): TruncationRefoldResult {
  const { configs, config, s2EntryCfgs, s2EntrySeedStates, toleranceSeconds } = ctx
  let { states, diag, tail } = init
  let truncationRefoldPasses = 0
  let truncationRefoldRejected = false
  let lastLimits: Map<number, number> | null = null
  // 参数放宽为 `readonly object[]`：原闭包里 `s2EntryCfgs` 是匿名对象类型（可赋给 Record），
  // 外提后 ctx 显式声明为 `CharacterOperationConfig[]`，类型上不再满足索引签名；语义逐位不变。
  const restoreCfgs = (snap: readonly object[]) => {
    configs.forEach((c, i) => {
      const rec = c as unknown as Record<string, unknown>
      for (const k of Object.keys(rec)) delete rec[k]
      Object.assign(rec, snap[i])
    })
  }
  for (let refoldPass = 0; refoldPass < ROW_REFOLD_MAX_PASSES; refoldPass++) {
    if (tail.timeTruncatedSeconds <= toleranceSeconds) break
    const keptBySlot = new Map<number, number>()
    for (const e of tail.truncationBySlot) {
      if (e.cutSeconds > toleranceSeconds) keptBySlot.set(e.slot, e.kept)
    }
    if (keptBySlot.size === 0) break
    // 不动点：本轮装配 kept 与上一轮写入的 rowTimeLimit 逐槽一致 ⇒ 账本已按真装得下的行计，停
    if (lastLimits && lastLimits.size === keptBySlot.size
      && [...keptBySlot].every(([slot, k]) => Math.abs((lastLimits!.get(slot) ?? Infinity) - k) <= 1e-3)) break
    // 上一次接受态的快照（拒绝时整体还原）
    // `diag` 存**引用**即可：随后换新对象，旧对象此后无人写 ⇒ 引用等价于旧式
    // 10 字段逐项值快照（口径 `engine:收敛读数归属`：诊断量归属被接受的那次调用）。
    const accepted = {
      cfgs: configs.map(c => ({ ...c })) as Record<string, unknown>[],
      states,
      diag,
      timeBudgetRefund: config.timeBudgetRefund,
      overflowSeconds: config.overflowSeconds,
      tail,
    }
    // 回到 S2 入口：cfg 还原为入口态 + 本轮 rowTimeLimit（其余槽不写），种子同规范种子，诊断量归零
    restoreCfgs(s2EntryCfgs)
    for (const cfg of configs) {
      const k = keptBySlot.get(cfg.slot)
      if (k !== undefined) cfg.rowTimeLimit = k
    }
    for (const cfg of configs) cfg.timeBudgetExcess = 0
    config.timeBudgetRefund = 0
    // 换新对象 = 旧式 10 字段逐项归零（`createSolveDiagnostics` 初值与旧 `:263–274` 逐字相同）。
    diag = createSolveDiagnostics()
    const r = ctx.rerun(diag, s2EntrySeedStates.map(s => ({ ...s })))
    states = r.states
    const trial = r.tail
    if (trial.timeTruncatedSeconds <= accepted.tail.timeTruncatedSeconds + 1e-6) {
      tail = trial
      lastLimits = keptBySlot
      truncationRefoldPasses += 1
      continue
    }
    truncationRefoldRejected = true
    // 拒绝：整体还原到上一次接受态（cfg 同一性保持），停止重折
    restoreCfgs(accepted.cfgs)
    states = accepted.states
    // 换回接受态那次调用的诊断对象（旧式 10 字段逐项还原；重折期间写的是已弃用的新对象）
    diag = accepted.diag
    config.timeBudgetRefund = accepted.timeBudgetRefund
    config.overflowSeconds = accepted.overflowSeconds
    tail = accepted.tail
    break
  }
  // rowTimeLimit 是本函数内部的迭代量：返回前恒删除（cfg 被外层不动点 / 热启动复用）
  for (const cfg of configs) delete cfg.rowTimeLimit
  return { states, diag, tail, passes: truncationRefoldPasses, rejected: truncationRefoldRejected }
}
