/**
 * S3a 末轮欠打回填 —— 自 `core/resource.ts#calcTeamResources` 的 `runTailPipeline` 外提
 * （CC-5a，2026-09-25）。
 *
 * 职责：折叠循环退出后按「预算 − 物化净占用」重测欠打量，**折半试探**注入 `timeBudgetRefund`
 * 并重收敛；接受三条件（内层判稳 + `trialRows ≤ 预算 − 容差` + 行数变多）全满足才接受，否则
 * 连 cfg 一起回滚。必须是可行性门控而不是逐轮跟随（refund→平A→回能→次数→物化行 是放大环）。
 *
 * 与旧块的差别**只有机械替换**：外层闭包变量改读 `ctx.*`、`runInnerLoop(x)` 注入 `ctx.innerCtx`、
 * 两个门槛常量（`UNDERFILL_PROBE_THRESHOLD_SECONDS` / `TIME_BUDGET_TOLERANCE_SECONDS`，其
 * `@fact` 锚指常量本身）经 ctx 注入。函数体逐字保留原表达式、顺序、回滚范围与常量；接受时写
 * `states` / `diag.timeBudgetRefundedSeconds`，进试探才写 `diag.timeBudgetIdleSeconds`。
 *
 * 依赖方向：本文件**不得** import `core/resource.ts`（防循环依赖）；只依赖类型、`./innerLoop`、
 * `./helpers`、`./crossAgentSupply` 与 `@/mechanics`。
 */
import { stunCountForCountChannel } from '@/core/stunPlanProjection'
import type {
  ResourceCalcConfig, CharacterOperationConfig, IterationState,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { runInnerLoop, type InnerLoopContext } from './innerLoop'
import { crossAgentSupplyAt, findCrossAgentSupplySlots, ultimateGiftOf } from './crossAgentSupply'
import { materializeRows } from './helpers'
import type { SolveDiagnostics } from './solveDiagnostics'

/** 欠打回填试探的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface UnderfillProbeContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  totalTime: number
  /** 内层次数收敛只读上下文（与折叠环共用同一台 `runInnerLoop`） */
  innerCtx: InnerLoopContext
  /** = `UNDERFILL_PROBE_THRESHOLD_SECONDS`（`resource.ts` 注入；常量与其 `@fact` 留在原地） */
  thresholdSeconds: number
  /** = `TIME_BUDGET_TOLERANCE_SECONDS`（`resource.ts` 注入） */
  toleranceSeconds: number
}

/**
 * ===== 末轮欠打回填（可行性门控，2026-09-05）=====
 * 上面折叠循环的 refund **冻结在 pass0**，而 pass0 恒测到**正** excess（此时平A池按权重满额发放
 * → 模块专属行爆量 → 行时间超账本）→ refund 被冻成 0；此后 excess 转负（账本 > 物化行 = 时间
 * 没打满）就再也拿不到回填。实测 96/125 预设 refund=0、41 队留白 >1s（最大 93.7s = 朱鸢/妮可/苍角
 * 的 1241 槽：账本必要 138.3s vs 物化必要行 44.6s），而 timeBudgetConverged 仍报 true——
 * 「收敛健康」掩盖了「动作只打了 86s」。
 * 修法：折叠循环退出后重测一次欠打量，**折半试探**注入 refund 并重收敛；只有「物化净占用更接近
 * 预算、且不越过预算」才接受，否则回滚该次注入。必须是可行性门控而不是逐轮跟随——
 * refund→平A→回能→次数→物化行 是放大环（naive 逐轮跟随实测：留白 1544s→267s 的同时
 * 超预算队从 8 推到 20，破坏 netFrontlineOccupation ≤ 预算 这条被轴退化/降配/队伍对比消费的
 * 硬不变量）。门控保证本步**绝不比现状差**：要么把留白收小，要么原样不动。
 * 债1批1-3已销号（2026-09-18）：折半试探门控经 seedInvariance.test.ts（104 预设 × 4 种子）
 * 机器判据验证，全库次数落点零偏差，天花板与净占用不变量保持稳定，离散修正影响已被约束在容差内。
 */
export function runUnderfillProbe(
  ctx: UnderfillProbeContext,
  diag: SolveDiagnostics,
  from: IterationState[],
): IterationState[] {
  let states = from
  const budgetSeconds = ctx.totalTime - (ctx.config.invincibleTime ?? 0)
  const chainGiftProvider = findCrossAgentSupplySlots(ctx.configs, 'gift-chain:chain')[0] ?? -1
  /**
   * Σ物化前台**净**占用：扣轴内合轴分摊 + 每槽超出该分摊的招式合轴抵扣（max 不叠加）——
   * 与超时判定单一事实源 `netFrontlineOccupation` **完全同口径**，否则试探门控放行、
   * 装配后仍超预算（实测差出 164s）。
   */
  const frontlineRowsOf = (st: IterationState[]): number => {
    const overlap = ctx.config.axisOverlapByAction ?? {}
    const overlapBySlot: number[] = ctx.configs.map(() => 0)
    for (const [key, sec] of Object.entries(overlap)) {
      const slot = Number(key.slice(0, key.indexOf(':')))
      const idx = ctx.configs.findIndex(c => c.slot === slot)
      if (idx >= 0 && Number.isFinite(sec)) overlapBySlot[idx] += sec
    }
    let total = 0
    const chainGiftInfo = crossAgentSupplyAt(ctx.configs, st, chainGiftProvider, {
      totalTime: ctx.totalTime, stunCount: stunCountForCountChannel(ctx.config), teamSize: ctx.config.teamSize,
    })
    // 琉音赠大：一律走 `ultimateGiftOf`（单一事实源，`@fact engine:赠送时间/轴模式四处同源` ③）——
    // 轴模式用轴预设计数（`config.axisUltimatePromote`），非轴用模块供给；不再在此内联轴分支（W19）
    const giftLiu = ultimateGiftOf(ctx.configs, st, {
      totalTime: ctx.totalTime, stunCount: stunCountForCountChannel(ctx.config), teamSize: ctx.config.teamSize,
      ...(ctx.config.axisMode ? { axisMode: true } : {}),
      ...(ctx.config.axisUltimatePromote ? { axisPromote: ctx.config.axisUltimatePromote } : {}),
    })
    const giftLiuTime = giftLiu.time
    const giftLiuTarget = giftLiu.targetIdx
    for (let i = 0; i < ctx.configs.length; i++) {
      const cfg = ctx.configs[i]
      const state = st[i]
      const teammateFrontline = ctx.configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + st[j].frontlineTime), 0)
      // 试探测量切 `materializeRows`（阶段1 第二刀收口，2026-09-09）：相位写入已拆到
      // `materializePhaseState`（引擎侧显式补写），产行钩子对 cfg 只读——试探测量由此与装配同源
      // （同一 `buildExecutions`）且不再污染相位。**实测否决记录（同日早间）**：当时 3 处相位写入
      // 仍在钩子里，切换后 golden 多 9 条 delta（全在 1431，c0 留白 57.9→65.4s）——顺序必须是
      // 「先拆相位写入、再切测量」，否则测出的是相位污染而不是测量口径差异。
      const probeRows = materializeRows(cfg, state, state.chainCountTotal, teammateFrontline)
      // 相位写入照旧补写（与折叠/装配同口径）：产行钩子已只读，写入由引擎显式声明。
      // 不补写 = 下一轮 estimate 读到上一次物化的陈旧值（实测 golden 10 条 delta：1431 c0 留白
      // 57.9→65.4s、1181:c6 ex −1.29）。
      getAgentMechanic(cfg.agentId)?.materializePhaseState?.({ cfg, state, executions: probeRows, teamFrontlineSeconds: teammateFrontline })
      const rowNet = probeRows.reduce(
        (sum, e) => sum + Math.max(0, (e.totalTime ?? 0)
          - (overlap[`${cfg.slot}:${e.moveId}`] ?? 0))
          * (isFrontlineExecution(e) ? 1 : 0),
        0) + (i === chainGiftInfo.targetIdx ? chainGiftInfo.time : 0)
          + (i === giftLiuTarget ? giftLiuTime : 0)
      const extraCredit = Math.max(0, (state.comboAlignCredit ?? 0) - overlapBySlot[i])
      total += Math.max(0, rowNet - extraCredit)
    }
    return total
  }
  /**
   * 内层次数收敛 = 折叠环同一台机器 `runInnerLoop`（判稳严格相等 + 精确环检测 + 浮点噪声环视为已收敛，规范停点）。
   * 2026-09-19 前这里是一段**裸循环**（只有严格判稳、无环检测）：连续收缩队（1431 剑势环 / 1531 回血环）的试探
   * 进入 ulp 级微环后永远「未稳」⇒ 回填一律被拒——单人 1431 命座 6 实测留白 29.0s、`auto-1431-1341-1311`
   * 留白 1.5s 都是这一处拒出来的。真整数环仍 stable=false（与 ⑤a「规范停点当稳」不同——那次 1591 系变差被否决）。
   */
  const convergeCounts = (from: IterationState[]) => {
    const r = runInnerLoop(from, ctx.innerCtx)
    return { states: r.end, stable: r.clean }
  }
  let rowsFilled = frontlineRowsOf(states)
  let underfill = budgetSeconds - rowsFilled
  // 门槛 = 1s（量化容差，2026-09-08 用户口径「平A权重与留白不应并存，剩余自由时间按权重
  // 全部分配」）：欠打 >1s 一律试探回填；≤1s 属量化地板（坑12「不追求精确 0」，合轴可覆盖），
  // 不试探。历史：09-05 门槛 10s（当时扫描 1s=335/41/2(+2队崩) 5s=353/31/2 10s=391/23/2 20s=421/20/2，
  // 「+2 队崩」= 近均衡队被推进 stunCount=0 吸引盆：失衡 116k→9.5k，runArchiveDeploy 雅/南宫/柚叶队崩）；
  // 09-08 引擎（1051/1531 实数化、轴栈资源门控、sigrid 估时钩子、琉音三件套）上 1s 门槛复核：
  // ratchet 绝对不变量/runArchiveDeploy/allAgentsSweep/yidhariInteractionGrid 全绿，旧盆不复现
  // （实测数字见 underfillRefund.test.ts 与 docs 坑19① 否决记录）。
  // **无排除队（2026-09-10 起）**：1591 一族原排除已于本日解除（见 `calcTeamResources` 顶部
  // 注释的实测依据）；1051/1531 于 2026-09-08 随热启动规范种子修复放回。
  if (underfill > ctx.thresholdSeconds) {
    let probe = underfill
    for (let attempt = 0; attempt < 4 && probe > 0.5; attempt++) {
      const savedRefund: number = ctx.config.timeBudgetRefund ?? 0
      // 试探轮跑 iterate 会触发模块钩子的**写回**（叶瞬光自动选轴在 estimateExSpecialTime 里
      // 按 timeBudgetExcess 退化并改 record.yeshuguangAutoAxis；般岳补齐同款通道）——被拒的
      // 试探必须连 cfg 一起回滚，否则结构选择被副作用永久改写（实测 1431 队留白 2.6→11.3s、
      // 伤害 −13%，就是退化后的轴留在了 cfg 上）。
      const savedCfg = ctx.configs.map(c => ({ ...c }))
      // overflowSeconds 是 iterate 的副作用输出（编排层拿它判「非轴降配」缩交互次数）：
      // 试探轮会写下自己的溢出值，被拒后若不回滚，编排层会按一个不存在的溢出把交互缩光
      // → 失衡归零（实测 runArchiveDeploy 雅/南宫/柚叶队 stunCount 螺旋到 0）。
      const savedOverflow = ctx.config.overflowSeconds ?? 0
      ctx.config.timeBudgetRefund = savedRefund + probe
      const trial = convergeCounts(states)
      const trialRows = frontlineRowsOf(trial.states)
      // 留 1× 容差余量：本步之后还有伊德海莉终局整数重推（实测 +1.3s）与外层不动点再平衡，
      // 试探测得的行数不是最终装配的行数。margin 扫描（棘轮回归队数）：0=1 队 1=1 队 2=3 队。
      const fitsBudget = trialRows <= budgetSeconds - ctx.toleranceSeconds
      if (trial.stable && fitsBudget && trialRows > rowsFilled) {
        states = trial.states
        rowsFilled = trialRows
        diag.timeBudgetRefundedSeconds = ctx.config.timeBudgetRefund ?? 0
        underfill = budgetSeconds - trialRows
        if (underfill <= ctx.toleranceSeconds) break
      } else {
        ctx.config.timeBudgetRefund = savedRefund // 回滚：宁可留白，不制造超预算
        ctx.config.overflowSeconds = savedOverflow
        ctx.configs.forEach((c, i) => Object.assign(c, savedCfg[i]))
        probe /= 2
      }
    }
    diag.timeBudgetIdleSeconds = Math.max(0, underfill)
  }
  return states
}
