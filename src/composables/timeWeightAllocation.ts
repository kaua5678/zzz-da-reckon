/**
 * 平A池权重·**分配策略注册表**（2026-09-10，用户口径驱动）。
 *
 * 背景（用户 2026-09-10）：「主C 的失衡期能量需求必须要平A时间」——**不分配足够的平A，总量也不够**。
 * 引擎侧实证（docs 坑35）：主C 平A池时间 → 能量总量 → 强特次数，实测把主C 的池子从 31.8s 提到 65.7s
 * 强特 16→18 次、单队伤害 +23.9%；而主计算路径用的是**静态默认权重**（强攻/异常/击破=1、支援/防护=0），
 * 127 预设里 **56 队的主C 被分少**，仅靠重新分配时间全库可拿 **+2.86%** 团队总伤。
 *
 * 为什么是**开关且默认关**（用户 2026-09-10 裁决）：「这个算的太慢了」——边际均衡一次 ≈ 3 倍求值
 * （实测均值 239.5ms/队、p90 494ms、最坏 1301ms，对照一次全队求值 78.6ms）。开与不开都是合法口径：
 * 关 = 静态默认/用户手填权重（当前基线与全部既有数值）；开 = 按策略重新分配。
 *
 * **扩展点（用户 2026-09-10：「这个自动计算以后还要加逻辑，比如能量不够就多a，甚至总时间可以把队友的
 * 时间都合轴」）**：新逻辑各自实现一个 `TimeWeightStrategy` 注册进 `TIME_WEIGHT_STRATEGIES` 即可，
 * UI 开关与 watcher 调用点都不用改。策略契约 = 读现况 → 写回各槽权重 → 返回诊断。
 */
import { watch } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { optimizeTeamTimeWeights } from '@/composables/teamTimeline'

type Calc = ReturnType<typeof useResourceCalc>
type ConfigStore = ReturnType<typeof useConfigStore>

export interface TimeWeightAllocationContext {
  calc: Calc
  configStore: ConfigStore
}

export interface TimeWeightAllocationResult {
  strategyId: string
  /** 应用后的各槽权重 */
  weights: number[]
  /** 应用后的团队总伤 */
  damage: number
  /** 是否真的改动了权重（可调槽位 <2 或已均衡时为 false） */
  applied: boolean
  note?: string
}

export interface TimeWeightStrategy {
  id: string
  label: string
  description: string
  allocate: (ctx: TimeWeightAllocationContext) => TimeWeightAllocationResult
}

/**
 * 策略⓪：**多杠杆联合搜索**（用户口径 2026-09-10：「总体而言是为了总伤最大化」+「弹刀这类交互
 * 也是伤害杠杆」+「弹刀多了也不能超过总时间，否则他可能无限制的加了」）。
 *
 * 搜索空间：① 平A 时间权重（委托边际均衡）；② **弹刀次数**（per-slot 交互杠杆，±阶梯坐标上升）。
 * 目标函数：团队总伤。**硬可行性门**：`overflowSeconds ≤ 0`（= 装配期没有发生时间线截断，
 * 即前台净占用 ≤ 预算）——**没有这道门，弹刀会无限加**：弹刀的 daze/喧响/闪能奖励照算，
 * 而超出的时间会被装配截断（坑22），模型于是「白拿奖励」，优化器会一路加到上限。
 * 这也是用户原话「弹刀多了也不能超过总时间」的机器面。
 *
 * 代价：≈ 边际均衡（~3 次求值）+ 弹刀阶梯（3 槽 × 2 方向 × ≤3 轮）≈ 15~20 次求值（~1.5s），
 * 因此只在这个**默认关**的开关后面跑。交互搜索的其它候选（闪避/快支、合轴）同题扩展。
 */
export const jointLeverStrategy: TimeWeightStrategy = {
  id: 'joint-levers',
  label: '多杠杆联合（平A 权重 + 弹刀）',
  description: '按团队总伤联合搜索平A 权重与弹刀次数；硬门 = 不发生时间线截断（不超总时间）',
  allocate(ctx) {
    const { calc, configStore } = ctx
    const weightsBefore = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const parryBefore = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.parryCount ?? 0)))
    const stunBefore = calc.stunPoolResult.value?.stunCount ?? 0
    /**
     * 可行性门 = **相对门：不许把「装不下」变得更差**（用户口径 2026-09-10：「39队直接拒绝那就删除防护，
     * 这总是在开发的时候拦截」）——原来是「截断必须为 0 否则拒绝」，于是**基线本身就超时的 39 队全被拒**，
     * 开发时看不到任何结果。改成相对判据：候选的截断量 ≤ 基线截断量。
     * · 基线不超时的队 → 等价于原来的「截断必须为 0」（防「弹刀无限加」的保护仍在）；
     * · 基线已超时的队（含轴模式队）→ 允许搜索，只要**不新增**截断（越界候选照旧回滚）。
     * **必须读结果自带的** `convergence.timeTruncatedSeconds`，不能读 `rr.overflowSeconds`——
     * 后者是 cfg 上的副作用字段（`calcTeamResources` 每次调用都写），一次预设求值跑十几次调用
     * （docs 坑33「尾巴专项」），读数会翻面（实测：门槛读 0 而终态 0.906s）。
     */
    const notes: string[] = []
    const truncation = () => calc.resourceResult.value?.convergence?.timeTruncatedSeconds ?? 0
    const baselineTruncation = truncation()
    const feasible = () => truncation() <= baselineTruncation + 1e-6
    if (baselineTruncation > 1e-6) {
      notes.push(`基线本身已超时（装配截断 ${baselineTruncation.toFixed(2)}s）→ 走相对门：只保证不更差`)
    }
    // ① 平A 权重（委托边际均衡；它自己不含可行性门，故候选若越界即回滚）
    const w = marginalEqualizeStrategy.allocate(ctx)
    if (!feasible()) {
      for (let s = 0; s < 3; s++) configStore.setBasicAttackTimeWeight(s, weightsBefore[s])
      notes.push('平A 权重均衡解越界（超时间），已回滚')
    } else if (w.note) {
      notes.push(w.note)
    }
    // ② 弹刀阶梯：±step 坐标上升，接受条件 = 伤害上升 **且** 仍可行 **且** 不低于 boss 预设的强制次数；
    // 最多 3 轮（成本上界）。允许**减少**交互（用户口径：「计算器里弹刀是自我选择的语境，可以根据收益抉择。
    // 允许减少交互，因为有时候主c的平a比队友弹刀好用」），但**下限 = boss 预设强制完成的次数**
    // （用户口径：「不能降低到boss预设的最低次数，因为boss预设的次数是强制完成的」）。
    // 与 `core/parrySplit.ts` 同源：`parryTotal` = 正常弹刀总次数（叶释渊 13 等），由 boss 预设声明；
    // `parryNoFollowUpTotal` 是另一类（无支援突击）且 split 已强制归击破位，不并进本下限。
    let best = calc.teamTotalDamage.value
    const STEP = 2
    const MAX_ROUNDS = 3
    const minParryTotal = Math.max(0, Number(configStore.appliedBoss?.parryTotal ?? 0))
    const totalParries = () => [0, 1, 2].reduce((acc, i) => acc + Math.max(0, Number(configStore.team[i]?.parryCount ?? 0)), 0)
    let floorBlocked = false
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let improved = false
      for (let slot = 0; slot < 3; slot++) {
        for (const dir of [STEP, -STEP] as const) {
          const cur = Math.max(0, Number(configStore.team[slot]?.parryCount ?? 0))
          const next = Math.max(0, Math.min(99, cur + dir))
          if (next === cur) continue
          if (dir < 0 && totalParries() + dir < minParryTotal) { floorBlocked = true; continue } // 强制次数下限
          configStore.setParryCount(slot, next)
          const dmg = calc.teamTotalDamage.value
          if (!feasible() || dmg <= best + 1e-6) {
            configStore.setParryCount(slot, cur) // 回滚：越界或没变好
          } else {
            best = dmg
            improved = true
          }
        }
      }
      if (!improved) break
    }
    if (floorBlocked) {
      notes.push(`弹刀下调被挡在 boss 预设强制次数（parryTotal=${minParryTotal}）`)
    }
    const parryAfter = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.parryCount ?? 0)))
    const parryMoved = parryAfter.some((v, i) => v !== parryBefore[i])
    if (parryMoved) {
      notes.push(`弹刀 ${parryBefore.join('/')}→${parryAfter.join('/')}（受「不发生截断」硬门约束）`)
    }
    const stunAfter = calc.stunPoolResult.value?.stunCount ?? 0
    if (stunAfter !== stunBefore) {
      notes.push(`失衡 ${stunBefore}→${stunAfter} 次（次数是分配的结果，未拦截）`)
    }
    const moved = parryMoved || w.applied
    return {
      strategyId: jointLeverStrategy.id,
      weights: [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0))),
      damage: calc.teamTotalDamage.value,
      applied: moved,
      note: notes.length > 0 ? notes.join('；') : undefined,
    }
  },
}

/**
 * 策略①：边际均衡（联合策略的①号子步，也可单独用）。
 * 用 `teamTimeline#optimizeTeamTimeWeights`（set-read-restore 经 `teamTotalDamage` 做有限差分坐标上升，
 * 纯算法见 `timeWeightBalancer#equalizeTimeWeights`）。支援/防护（权重 0）不参与转移，时间总权重守恒。
 *
 * **目标函数 = 团队总伤；失衡次数不是约束，而是分配的结果**（用户口径 2026-09-10，两轮修正后定稿）：
 * ①「失衡次数只是第一个决策…总体而言是为了**总伤最大化**」；
 * ②「给击破更多权重，结果导致总失衡次数下降，总伤害肯定也下降了。这是因为**扳机的战场性能比希希芙低很多**，
 *   所以这队的玩法是不论失衡有没有四舍五入，**都不该给扳机分配平A时间**。这又把第一条逻辑打回去了…
 *   我们最终目的是为了总伤提高，**失衡四舍五入不一定让总伤提高**，所以此处**打失衡的手段必须换成更高效的
 *   方式，比如弹刀**。」
 * → 曾经把次数做成硬约束（均衡解掉次数就回滚）**已按此撤销**：那会把「低性能击破位不该拿平A」这个正确
 *   结论反过来锁死。次数变化改为**如实上报**（`note`），供人裁决，不做拦截。
 * 关联：`docs/ENGINE_PIPELINE_GUIDE.md` 坑35（含「打失衡手段效率」的实测表）。
 */
export const marginalEqualizeStrategy: TimeWeightStrategy = {
  id: 'marginal-equalize',
  label: '边际均衡',
  description: '按团队总伤的边际产出在槽位间转移平A时间（保住主C 的能量需求；一次 ≈ 3 倍求值）',
  allocate({ calc, configStore }) {
    const before = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const stunBefore = calc.stunPoolResult.value?.stunCount ?? 0
    const r = optimizeTeamTimeWeights(calc, configStore, { maxIter: 2 })
    const stunAfter = calc.stunPoolResult.value?.stunCount ?? 0
    const moved = r.weights.some((w, i) => Math.abs(w - before[i]) > 1e-9)
    const notes: string[] = []
    if (!r.balanced) notes.push('可调槽位 <2（只有一个槽位权重 >0），跳过')
    else if (!moved) notes.push('已是均衡解，权重未变')
    if (r.balanced && stunAfter !== stunBefore) {
      // 如实上报（不拦截）：次数是分配的结果；要更多失衡应换更高效的手段（弹刀），不是给低性能击破位平A
      notes.push(`均衡后失衡 ${stunBefore}→${stunAfter} 次（次数是分配的结果，未拦截；需更多失衡请提高弹刀等交互）`)
    }
    return {
      strategyId: 'marginal-equalize',
      weights: r.weights,
      damage: r.damage,
      applied: r.balanced && moved,
      note: notes.length > 0 ? notes.join('；') : undefined,
    }
  },
}

/** 策略注册表（扩展点：`energy-driven` / `team-combo-align` 等新策略往这里加，调用点不动） */
export const TIME_WEIGHT_STRATEGIES: TimeWeightStrategy[] = [jointLeverStrategy, marginalEqualizeStrategy]

export const DEFAULT_TIME_WEIGHT_STRATEGY_ID = jointLeverStrategy.id

export function getTimeWeightStrategy(id: string = DEFAULT_TIME_WEIGHT_STRATEGY_ID): TimeWeightStrategy {
  return TIME_WEIGHT_STRATEGIES.find(s => s.id === id)
    ?? TIME_WEIGHT_STRATEGIES.find(s => s.id === DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    ?? jointLeverStrategy
}

/** 应用一个分配策略（默认=边际均衡） */
export function applyTimeWeightAllocation(
  ctx: TimeWeightAllocationContext,
  strategyId?: string,
): TimeWeightAllocationResult {
  return getTimeWeightStrategy(strategyId).allocate(ctx)
}

/**
 * 触发签名：只含「应当重新分配」的输入（队伍成员/命座/音擎/驱动盘/交互次数…），
 * **刻意排除 `basicAttackTimeWeight` 本身**——否则策略写回权重会自触发成死循环。
 */
export function timeWeightAllocationSignature(configStore: ConfigStore): string {
  return JSON.stringify(configStore.team.map(c => {
    const o = { ...c } as Record<string, unknown>
    delete o.basicAttackTimeWeight
    return o
  }))
}

/**
 * 开关接线：`configStore.autoAllocateBasicTime` 打开时，队伍签名变化后自动跑一次策略。
 *
 * 为什么放在 composable 而不是引擎里：策略要**读伤害**（`teamTotalDamage`）才能做有限差分，
 * 而它自己又写权重 → 放进响应式计算会递归。这里是「计算外侧」的一次显式求解，与金数分配路径
 * （`teamTimeline` 的 `allocateGoldByGreedy`）同款做法。
 *
 * 性能与安全：只在开关打开时干活（关闭时零成本——`useResourceCalc()` 只建惰性 computed）；
 * 重入保护避免抖动（上一次未算完就跳过本轮，不排队）。
 */
export function useTimeWeightAutoAllocation(): { applyNow: () => TimeWeightAllocationResult } {
  const configStore = useConfigStore()
  const calc = useResourceCalc()
  let running = false
  const run = () => {
    if (!configStore.autoAllocateBasicTime || running) return
    running = true
    try {
      applyTimeWeightAllocation({ calc, configStore })
    } finally {
      running = false
    }
  }
  watch(
    () => [configStore.autoAllocateBasicTime, timeWeightAllocationSignature(configStore)] as const,
    () => run(),
    { flush: 'post' },
  )
  return { applyNow: () => applyTimeWeightAllocation({ calc, configStore }) }
}
