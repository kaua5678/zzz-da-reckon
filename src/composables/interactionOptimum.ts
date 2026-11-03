/**
 * 统一交互边际求解。只通过 TimeWeightStrategy 注册入口运行；调用方提供完整引擎与权重均衡子步。
 * 离散计数的驻点 = 每个可行 ±1 邻居均无正收益；跨失衡/资源节点用自适应步长试探，整步按总伤判定。
 * 不把失衡/嗔火/窗口数作为目标或下界。手动锁在任何写入之前返回。
 */
import { ACTION_COUNT_BOUNDS, type ActionCountField } from '@/stores/config'
import type { TimeWeightAllocationContext, TimeWeightAllocationResult, TimeWeightStrategy } from '@/composables/timeWeightAllocation'
import { absorbCapOf, interactionFieldsAt, TAUNT_CANCEL_FULL, tauntLeverSlots, INTERACTION_COUNT_KEYS } from '@/composables/interactionControls'
import { getAgentMechanic } from '@/mechanics/registry'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { axisStateOf } from '@/composables/difficultyAxis'
import { computeDifficulty } from '@/composables/operationalDifficulty'
import { liveInteractions } from '@/composables/liveInteractions'
import { stunWindowRatioOf } from '@/composables/difficultyRatio'
import { frontlineOccupationBreakdown } from '@/core/resource/timeOccupation'

export const INTERACTION_OPTIMUM_STRATEGY_ID = 'interaction-optimum'
export interface InteractionOptimumOptions {
  /** 曲线中间档保留正在探测的吸收率；最高档先将净收益项拉满。 */
  maximizeNetGains?: boolean
  absorbCap?: number
}
export interface InteractionOptimumReading {
  costDetail: string
  difficulty: number
  stunCount: number
  overflowSeconds: number
  counts: Array<{ slot: number; fields: Partial<Record<ActionCountField, number>> }>
  elapsedMs: number
  evaluations: number
  converged: boolean
}
interface Coordinate { slot: number; field: ActionCountField; min: number; max: number }
interface SearchState {
  counts: number[]
  weights: number[]
  absorb: number
  taunts: number[]
}
interface Score { damage: number; executed: number; overflow: number; amount: number; axisFallback: boolean; axisComplete: boolean; repairTotal: number }
const DAMAGE_EPS = 1e-6
const TIME_EPS = 1e-6

/** 全部出口读数取同一现场，难度只经 computeDifficulty，时间压力只经 frontlineOccupationBreakdown。 */
export function interactionOptimumReading(ctx: TimeWeightAllocationContext, elapsedMs = 0, evaluations = 0, converged = true): InteractionOptimumReading {
  const rr = ctx.calc.resourceResult.value
  const overflowSeconds = rr?.convergence.timeTruncatedSeconds ?? 0
  const cost = computeDifficulty(liveInteractions(ctx.configStore, undefined, rr), ctx.configStore.team.map(c => c.agentId),
    overflowSeconds, undefined, rr ? frontlineOccupationBreakdown(rr).saved : 0,
    stunWindowRatioOf(ctx.calc, ctx.configStore.enemy))
  return {
    costDetail: cost.detail, difficulty: cost.difficulty,
    stunCount: ctx.calc.stunPoolResult.value?.stunCount ?? 0, overflowSeconds,
    counts: ctx.configStore.team.flatMap((c, slot) => c.agentId ? [{ slot, fields: Object.fromEntries(
      [...new Set([...INTERACTION_COUNT_KEYS, ...interactionFieldsAt(ctx.configStore, slot)])]
        .flatMap(field => typeof c[field] === 'number' ? [[field, c[field]]] : []),
    ) }] : []), elapsedMs, evaluations, converged,
  }
}

function coordinatesOf(ctx: TimeWeightAllocationContext): Coordinate[] {
  const config = ctx.configStore
  return config.team.flatMap((row, slot) => interactionFieldsAt(config, slot).map(field => {
    const bounds = ACTION_COUNT_BOUNDS[field]
    const climb = row.agentId ? getAgentMechanic(row.agentId)?.interactionClimb : undefined
    // 比例分母在首次写入前冻结，防手动值反过来抬高自己的上限。
    const rr = ctx.calc.resourceResult.value
    const anchor = climb?.field === field && rr ? climb.anchorOf(rr) : undefined
    return { slot, field, min: bounds.min,
      max: anchor === undefined ? bounds.max : Math.min(bounds.max, climb!.capOf(anchor, config.getMechanicSetting)) }
  }))
}

// @fact engine:交互优化/自动驻点 口径: 自动交互以完整引擎总伤为目标，在不新增装配截断的可行域检查逐槽±1邻域；跨节点试探同样只按实际伤害净增接受，不设失衡/嗔火/窗口目标；交互锁或失衡锁开启时零写入 | 据 用户@2026-11-03 | 验 src/composables/__tests__/interactionOptimum.test.ts | 锚 src/composables/interactionOptimum.ts#createInteractionOptimumStrategy | 信 确认
// ⟳复核: 交互能力声明、引擎截断或资源节点算法变化时重跑全库单调性与邻域见证 | 到期 2027-04-30
export function createInteractionOptimumStrategy(_balance?: (ctx: TimeWeightAllocationContext) => TimeWeightAllocationResult): TimeWeightStrategy {
  return {
    id: INTERACTION_OPTIMUM_STRATEGY_ID, label: '自动最优交互',
    description: '净收益项拉满后，按总伤边际选择各槽交互；伤害不降、截断不增，无目标次数',
    allocate(ctx) {
      const start = performance.now()
      const { configStore: config, calc } = ctx
      const result = (applied: boolean, note?: string, evaluations = 0): TimeWeightAllocationResult => ({
        strategyId: INTERACTION_OPTIMUM_STRATEGY_ID,
        weights: config.team.map(c => c.basicAttackTimeWeight), damage: calc.teamTotalDamage.value, applied, note,
        ...interactionOptimumReading(ctx, performance.now() - start, evaluations),
      })
      if (config.interactionsLocked || config.enemy.stunCountLock >= 0) return result(false, '手动锁定：保留输入')
      if (!calc.resourceResult.value) return result(false, '无可计算队伍')
      const coords = coordinatesOf(ctx)
      const taunts = tauntLeverSlots(config)
      const capture = (): SearchState => ({
        counts: coords.map(c => Number(config.team[c.slot]?.[c.field] ?? 0)),
        weights: config.team.map(c => c.basicAttackTimeWeight),
        absorb: config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO),
        taunts: taunts.map(slot => config.team[slot]!.tauntCancelCount ?? 0),
      })
      const restore = (s: SearchState) => {
        coords.forEach((c, i) => config.setActionCount(c.slot, c.field, s.counts[i]!))
        s.weights.forEach((w, slot) => config.setActionCount(slot, 'basicAttackTimeWeight', w))
        config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, s.absorb)
        taunts.forEach((slot, i) => config.setActionCount(slot, 'tauntCancelCount', s.taunts[i]!))
      }
      let evaluations = 0
      const scores = new Map<string, Score>()
      const score = (): Score => {
        const key = JSON.stringify(capture())
        const hit = scores.get(key)
        if (hit) return hit
        evaluations++
        const damage = calc.teamTotalDamage.value
        // 执行数接受门（卡 §6.3b）：加交互不得把主C动作挤掉。
        // ⚠ 读**同一个** resourceResult 快照内的读数；不要读 stackTraversalResult（独立 computed，会重算一遍轴栈，
        // 实测把单队策略从 ~20s 抬到 ~222s）。
        const rrNow = calc.resourceResult.value
        let executed = 0
        for (const c of rrNow?.characters ?? []) executed += c.exSpecialCount
        const value = { damage, executed, overflow: rrNow?.convergence.timeTruncatedSeconds ?? 0,
          axisFallback: rrNow?.convergence.axisFallback === true,
          axisComplete: true,
          repairTotal: 0,
          amount: coords.reduce((sum, c) => sum + Number(config.team[c.slot]?.[c.field] ?? 0), 0) }
        scores.set(key, value)
        return value
      }
      // 曲线中间档（maximizeNetGains=false）只要「比原档更好」即可，给更紧的预算；
      // 最高档/主页/实战才跑完整搜索（用户口径：最高档必须最准）。
      /**
       * 求值预算：最高档（主页/散点/实战）跑满 180；`maximizeNetGains === false`（曲线视图档位）跑 24。
       * 实测 40 会让 difficultyLadder.test 从 2 分钟涨到 10 分钟以上。
       */
      const EVAL_BUDGET = ctx.interactionOptions?.maximizeNetGains === false ? 24 : 180
      const initial = capture()
      const initialScore = score()
      let bestState = initial
      let best = initialScore
      /**
       * 可行 = 伤害有限 **且没弃轴**。
       *
       * 「最高操作难度」的定义里轴必须成立（用户口径：最高档 = 最强**理论** dps，弃轴的队伍不是同一套理论）。
       * 硬约束而不是事后筛：策略自己把交互推到装不下时，应当退回上一个可行点，而不是交给调用方去丢弃。
       * 判据取 `convergence.axisFallback`（零额外求值；不读 `stackTraversalResult` —— 那是独立 computed，会重算整条轴栈）。
       */
      const feasibleScore = (s: Score) => Number.isFinite(s.damage) && !s.axisFallback
      const compareCandidates = (a: Score, b: Score) => {
        if (a.overflow > b.overflow + TIME_EPS) return -1
        if (b.overflow > a.overflow + TIME_EPS) return 1
        if (Math.abs(a.damage - b.damage) > DAMAGE_EPS) return a.damage - b.damage
        // 同伤害 ⇒ 选动作数多的一侧（卡 §6.3b 的意图保留在这一层）
        return a.executed - b.executed
      }
      const seeds: SearchState[] = [capture()]
      restore(initial)
      /**
       * 接受门：① 伤害不降（用户口径「自动永不劣化」的第一条）；② 截断不增。
       *
       * ⚠ 执行数（卡 §6.3b）**不作为硬门**：实测它会挡掉「+1 闪反提伤但动作数微降」的真实收益档，
       * 与「总伤最大」的目标冲突。改为**同伤害时的次级择优**（见 compareCandidates），
       * 既保留「同等伤害下选动作多的」，又不牺牲伤害。
       */
      const admissible = (s: Score, floor: Score) => Number.isFinite(s.damage)
        && s.damage >= floor.damage - DAMAGE_EPS && s.overflow <= floor.overflow + TIME_EPS
      const better = (s: Score, floor: Score) => admissible(s, floor) && (s.damage > floor.damage + DAMAGE_EPS
        || (Math.abs(s.damage - floor.damage) <= DAMAGE_EPS && (s.overflow < floor.overflow - TIME_EPS
          || (Math.abs(s.overflow - floor.overflow) <= TIME_EPS && s.amount < floor.amount))))
      for (const seed of seeds) {
      restore(seed)
      // 先取净收益。临时试探可以跨越中间低谷，但仅将整体净增且无新截断的终点交付调用方。
      if (ctx.interactionOptions?.maximizeNetGains !== false) {
        config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbCapOf({ config, calc, absorbCap: ctx.interactionOptions?.absorbCap }))
      }
      for (const slot of taunts) config.setActionCount(slot, 'tauntCancelCount', TAUNT_CANCEL_FULL)
      let current = score()
      const remember = () => {
        if (feasibleScore(current) && compareCandidates(current, best) > 0) {
          best = current; bestState = capture()
        }
      }
      remember()
      // 自适应坐标搜索：每轮先穷尽 ±1；驻点时沿各坐标做对数级跨节点试探，避免把局部平坦误作节点无收益。
      // 不是全网格：每条坐标 O(log 上限) 个远邻，失败即回滚；最终必须再完整检查 ±1 才停。
      // 预算只约束跨节点试探的广度；±1 收尾**不受预算约束**——否则会被判成「没收敛」。
      for (;;) {
        let moved = false
        for (const c of coords) {
          const value = Number(config.team[c.slot]?.[c.field] ?? 0)
          let winner = value; let winningScore = current
          for (const next of [value - 1, value + 1]) {
            if (next < c.min || next > c.max) continue
            config.setActionCount(c.slot, c.field, next)
            const trial = score()
            if (better(trial, winningScore)) { winner = next; winningScore = trial }
          }
          config.setActionCount(c.slot, c.field, winner)
          if (winner !== value) { current = winningScore; moved = true; remember() }
        }
        if (moved) continue
        if (evaluations >= EVAL_BUDGET) break
        const base = capture()
        let jumpState: SearchState | undefined
        let jumpScore = current
        for (const c of coords) {
          const value = Number(config.team[c.slot]?.[c.field] ?? 0)
          for (let step = 2; step < c.max - c.min; step *= 2) {
            for (const next of [Math.max(c.min, value - step), Math.min(c.max, value + step)]) {
              if (next === value) continue
              config.setActionCount(c.slot, c.field, next)
              const trial = score()
              if (better(trial, jumpScore)) { jumpScore = trial; jumpState = capture() }
            }
          }
          restore(base)
        }
        if (jumpState) { restore(jumpState); current = jumpScore; remember(); continue }
        break
      }
      }
      /**
       * **收尾：轴完整性校验**（只做**一次**，不放进评分内）。
       *
       * `axisFallback` 只能抓「弃轴」(`infeasible`)，抓不到「跳过若干招」(`partial`)。
       * 而「最高操作难度」的定义要求轴**打完整**——跳招换来的高总伤不是同一个理论 dps。
       *
       * ⚠ 不能放进 `score()` 每步判：`stackTraversalResult` 是独立 computed，读它会重算整条轴栈，
       * 实测把单队策略从 ~19s 抬到 ~222s。只在**收尾**验一次，代价一次求值。
       */
      restore(bestState)
      const axisState = axisStateOf(calc)
      const axisIntact = axisState.kind !== 'partial' && axisState.kind !== 'infeasible'
      if (!axisIntact && config.useStunAxis) {
        // 轴队：退回起点（全 0 + 角色声明基准）——那是「轴一定打完整」的安全现场
        restore(initial)
        return result(false, `轴被打残（跳过 ${axisState.kind === 'partial' ? axisState.skippedTotal : '全部'} 招）⇒ 保留输入：跳招换来的总伤不算最高难度`)
      }
      const applied = JSON.stringify(bestState) !== JSON.stringify(initial)
      return result(applied, `逐槽±1无可行正收益${evaluations >= EVAL_BUDGET ? '（跨节点试探达预算）' : ''}；失衡次数为分配结果`, evaluations)
    },
  }
}
