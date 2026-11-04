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
interface Score { damage: number; executed: number; rows: number; skips: number; overflow: number; amount: number; axisFallback: boolean; axisBroken: boolean; repairTotal: number }
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
        const rrNow = calc.resourceResult.value
        /**
         * ## 执行数（卡 §6.3b）—— 必须量**轴内实际执行的动作数 + 伤害池行数**
         *
         * 用户逐字：「你击破耗那么多时间，**考虑过主c动作被挤压没有**……**时间截断才是强制的**」。
         *
         * ⚠ **旧实现量错了指标**（2026-11-04 实测）：它累加 `rr.characters[].exSpecialCount`，
         * 而该读数在「加弹刀」这条路上**恒不变**（实测 17 → 17），于是门形同虚设——
         * 同一现场的实际轴内动作数却从 **45 掉到 39**（主C 槽 14/14/14/3 → 12/12/12/3），失衡窗 7→6。
         * 这正是 §6.3b 点名要拦的形态，却被漏判。
         *
         * 现口径与 §6.3b 的机器判据**同源**：`stackTraversalResult.executed` 计数总和 + 伤害池行数
         * （两条通道都量：前者「轴内打出来的」、后者「进伤害池的」）。
         * 代价：`stackTraversalResult` 是纯读取的 computed（50 次连读增量 0ms，见 `.zc/perf/cost.perf.ts`）。
         */
        let executed = 0
        for (const v of Object.values(calc.stackTraversalResult.value?.executed ?? {})) executed += v.count
        const rows = calc.damagePoolRows.value.length
        /**
         * **轴完整性**（`partial` = 跳过若干招）。
         *
         * ⚠ 早先注释说「读 `stackTraversalResult` 会重算整条轴栈、单队 19s→222s」——**实测是错的**：
         * 它是 `computed(() => calcOutput.value?.axisStack ?? null)`，纯读取已缓存的引擎输出，
         * 50 次连读测得的增量是 **0ms**（见 `.zc/perf/cost.perf.ts`）。
         * 那次 222s 的真实原因是**别处**的级联（执行数门当时的写法）。
         * ⇒ 轴完整性可以放进每步评分，这正是曲线 ④ 能同源的前提。
         */
        const skips = calc.stackTraversalResult.value?.skipped.length ?? 0
        const axisBroken = skips > 0
        const value = { damage, executed, rows, skips, overflow: rrNow?.convergence.timeTruncatedSeconds ?? 0,
          axisFallback: rrNow?.convergence.axisFallback === true,
          axisBroken,
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
      /**
       * ## 候选记录**分两档**，而不是用「轴完整」当步进硬门（2026-11-04 修，实测驱动）
       *
       * 旧实现 `feasibleScore` 要求 `!axisBroken`，且 `remember()` **只记录**通过它的点。
       * 而 ④ 的搜索起点（① 现场 = 全 0 交互 + 角色声明基准）**本来就是 `partial`**（轴喂不饱）——
       * 于是整轮搜索**没有任何一个点被记录**，`bestState` 恒为起点 ⇒ 交付「零交互 + partial」，
       * 曲线 ④ 随之退化。**表现像「边际判据判定不动」，真因是记录门把起点之外全滤掉了。**
       *
       * 实测（`.zc/perf`，同一现场网格扫描，不是策略输出）：
       * - 曲线夹具 `auto-1611-1141-1211`（FAKE_BOSS 3.2）：策略 50.94M / `partial` 跳 2 招 / 交互 0；
       *   同现场存在 **63.31M / `complete` / 溢出 0** 的点（`parry0=16, dodge0=8`）。
       * - 同队生产权重现场：策略 74.55M / `partial` 跳 4 招；可达 **90.19M / `complete`**（`dodge0=40, parry0=10`）。
       *
       * ⇒ 口径不变（**最高操作难度 = 最强理论 dps，轴必须打完整**），改的是**搜索的表达方式**：
       * - **硬拒只留「弃轴」**（`axisFallback` / 伤害非有限）——那是时间路，不是同一套理论，不能当候选；
       * - `partial` 是**可穿越的中间态**（步进门 `admissible` 本来就允许「伤害不降 + 截断不增」地走过它）；
       * - **记录**分 `intact` / `fallen` 两档，交付时**完整轴优先**；一个完整点都到不了才退回最好的 partial
       *   （此时「轴没打完」由调用方按自己的判据处置，策略不假装它是最优解）。
       */
      const isFallback = (s: Score) => !Number.isFinite(s.damage) || s.axisFallback
      let bestIntact: { s: Score; state: SearchState } | null = null
      /** 起点可能是 partial ⇒ 先以它为「残缺档」兜底，保证交付**永不劣于起点** */
      let bestFallen: { s: Score; state: SearchState } = { s: initialScore, state: initial }
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
       * ## 接受门（逐**步**判，相对上一步）
       *
       *  ① **伤害不降**（用户口径「自动永不劣化」）；
       *  ② **截断不增**；
       *  ③ **修轴臂**：轴内被跳过的招数**变少**本身就是正收益（用户 2026-10-15「我要的是你
       *     达到资源要求然后计算」）——轴未成立时加交互纯亏钱，只认「伤害不降」会让轴永远修不回来。
       *
       * ## ⚠ §6.3b（执行数不降）为什么**不是**逐步硬门（2026-11-04 实测归因）
       *
       * 上一轮把 §6.3b 从硬门降成「同伤害时次级择优」，理由是「它会挡掉 +1 闪反提伤但动作数微降的档」。
       * 本轮先把它恢复成硬门，实测发现**两种归因都不完整**——真正的机制是：
       *
       * `executed` 下降的主因不是「主C 动作被挤掉」，而是**失衡窗口数变少**：
       * 实测本夹具槽0 弹刀 4→10 时 `executed` 33/40/34/28 随 `stun 5/6/5/4` 同步起伏
       * （`executed` = 轴内动作 × 窗口数）。窗口少一个，动作数就少一截，而**伤害可能更高**
       * （实测 parry=7 → 75.17M/exec40，parry=8 → 86.23M/exec34，**+11M**）。
       *
       * ⇒ 若把 §6.3b 当逐步硬门，策略必须拒绝「+11M」才能保住一个**由窗口数而非挤压驱动**的计数，
       * 与用户「最高难度最强」的目标直接冲突（实测四个入口系统性偏低 11M）。
       *
       * 用户原话针对的是「时间不够 ⇒ 动作打不出来」——那是**截断**（门 ② 已守住，`overflow` 不增）。
       * 窗口数变化不是「打不出来」，是「这队在这套交互下只进这么多次失衡」。
       *
       * 故 §6.3b 的机器面保留在**同伤害时的次级择优**（同等伤害下选动作多的），
       * 而「不许靠截断换伤害」由门 ② 硬守。这是一条**口径选择**，已在该轮交接里上报待真人确认。
       */
      const admissible = (s: Score, floor: Score) => Number.isFinite(s.damage)
        && s.damage >= floor.damage - DAMAGE_EPS && s.overflow <= floor.overflow + TIME_EPS
      /**
       * ## 修轴臂（旧 `optimizeInteractionsPerSlot` 的同一条，2026-11-04 移植回来）
       *
       * 起点轴不成立时（① 全 0 交互后是常态），只认「伤害不降」会让搜索在**第一次**加交互就被拒：
       * 金身/双反那一步的伤害是**为轴付钱**，未跨过资源阈值前纯亏。
       *
       * 用户口径 2026-10-15「我要的是你**达到资源要求然后计算**」⇒ 轴未成立时段，
       * 「轴内被跳过的招数**变少**」本身就是正收益：接受该步（伤害让位），后续步继续按「少跳」爬；
       * 一旦轴成立，立刻回到严格门。
       *
       * ⚠ §6.3b（执行数）**不在本门里**，理由见上面「为什么不是逐步硬门」那段（窗口数变化 ≠ 动作被挤掉）；
       * 它保留为**同伤害时的次级择优**（`compareCandidates` 的末位）。
       * 另两条（**截断不增** / 伤害不降）在修轴臂里**照旧生效** —— 「时间不够打不出动作」由截断门硬守。
       */
      const better = (s: Score, floor: Score) => {
        if (!admissible(s, floor)) return false
        // 修轴臂：少跳一招就是进步（**伤害**可以让位）
        if (floor.skips > 0 && s.skips < floor.skips) return true
        return s.damage > floor.damage + DAMAGE_EPS
          || (Math.abs(s.damage - floor.damage) <= DAMAGE_EPS && (s.overflow < floor.overflow - TIME_EPS
            || (Math.abs(s.overflow - floor.overflow) <= TIME_EPS && s.amount < floor.amount)))
      }
      for (const seed of seeds) {
      restore(seed)
      // 先取净收益。临时试探可以跨越中间低谷，但仅将整体净增且无新截断的终点交付调用方。
      if (ctx.interactionOptions?.maximizeNetGains !== false) {
        config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbCapOf({ config, calc, absorbCap: ctx.interactionOptions?.absorbCap }))
      }
      for (const slot of taunts) config.setActionCount(slot, 'tauntCancelCount', TAUNT_CANCEL_FULL)
      let current = score()
      /**
       * 记录候选：**完整轴优先、partial 只作兜底**。
       * 两档都按同一 `compareCandidates` 择优（截断优先、其次伤害、再其次动作数）。
       */
      const remember = () => {
        if (isFallback(current)) return
        if (current.axisBroken) {
          if (compareCandidates(current, bestFallen.s) > 0) bestFallen = { s: current, state: capture() }
          return
        }
        if (!bestIntact || compareCandidates(current, bestIntact.s) > 0) bestIntact = { s: current, state: capture() }
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
       * **收尾：交付点选择**（完整轴优先，partial 兜底）。
       *
       * 旧实现在这里再做一次「轴被打残 ⇒ 退回起点」的硬拒，配合上面那个把 partial 全滤掉的记录门，
       * 结果就是 partial 起点的队**必然交付零交互的起点**（曲线 ④ 退化的直接成因，见上面 `remember` 注释）。
       *
       * 现口径：搜索期间 `partial` 只是**可穿越的中间态**，交付时按档择优——
       * 有完整轴候选就用它（这是「最高操作难度」的定义）；一个都没有才退回最好的 partial。
       * 真·轴队（`useStunAxis`）拿不到完整轴时仍**保留输入**（不把残轴当最优解交付）。
       */
      const winner = bestIntact ?? bestFallen
      restore(winner.state)
      const axisState = axisStateOf(calc)
      const axisIntact = axisState.kind !== 'partial' && axisState.kind !== 'infeasible'
      if (!axisIntact && !bestIntact && config.useStunAxis) {
        // 轴队且**爬不到**完整轴：退回起点（全 0 + 角色声明基准）——不把残轴当最高难度交付
        restore(initial)
        return result(false, `轴被打残（跳过 ${axisState.kind === 'partial' ? axisState.skippedTotal : '全部'} 招）⇒ 保留输入：跳招换来的总伤不算最高难度`)
      }
      const applied = JSON.stringify(winner.state) !== JSON.stringify(initial)
      const tierNote = bestIntact ? '' : '；无可达完整轴，退回最好残缺档'
      return result(applied, `逐槽±1无可行正收益${evaluations >= EVAL_BUDGET ? '（跨节点试探达预算）' : ''}${tierNote}；失衡次数为分配结果`, evaluations)
    },
  }
}
