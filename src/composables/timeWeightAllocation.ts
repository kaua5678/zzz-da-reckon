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
 * 策略①：边际均衡（当前唯一实现）。
 * 用 `teamTimeline#optimizeTeamTimeWeights`（set-read-restore 经 `teamTotalDamage` 做有限差分坐标上升，
 * 纯算法见 `timeWeightBalancer#equalizeTimeWeights`）。支援/防护（权重 0）不参与转移，时间总权重守恒。
 */
export const marginalEqualizeStrategy: TimeWeightStrategy = {
  id: 'marginal-equalize',
  label: '边际均衡',
  description: '按团队总伤的边际产出在槽位间转移平A时间（保住主C 的能量需求；一次 ≈ 3 倍求值）',
  allocate({ calc, configStore }) {
    const before = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const r = optimizeTeamTimeWeights(calc, configStore, { maxIter: 2 })
    const moved = r.weights.some((w, i) => Math.abs(w - before[i]) > 1e-9)
    return {
      strategyId: 'marginal-equalize',
      weights: r.weights,
      damage: r.damage,
      applied: r.balanced && moved,
      note: r.balanced ? undefined : '可调槽位 <2（只有一个槽位权重 >0），跳过',
    }
  },
}

/** 策略注册表（扩展点：`energy-driven` / `team-combo-align` 等新策略往这里加，调用点不动） */
export const TIME_WEIGHT_STRATEGIES: TimeWeightStrategy[] = [marginalEqualizeStrategy]

export const DEFAULT_TIME_WEIGHT_STRATEGY_ID = marginalEqualizeStrategy.id

export function getTimeWeightStrategy(id: string = DEFAULT_TIME_WEIGHT_STRATEGY_ID): TimeWeightStrategy {
  return TIME_WEIGHT_STRATEGIES.find(s => s.id === id) ?? marginalEqualizeStrategy
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
