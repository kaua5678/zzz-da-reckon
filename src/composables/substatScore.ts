/**
 * 副词条「评分」：当前副词条 **相对 0 副词条** 的全队伤害增益，并按来源拆解每一项的贡献。
 *
 * ## 口径
 * - **基线 = 0 副词条**（三个槽位的 `driveDisc.subStatAllocation` 全部清空），目标 = 当前配装。
 *   百分比分母 = 0 副词条时的队伍总伤 ⇒ 评分 = (当前 / 0词条 − 1) × 100。
 * - **拆解 = 精确 Shapley**（玩家 = 一个槽位的一个词条，如「槽0·精通」）。
 *   Shapley 满足**有效性**：Σ 各玩家贡献 ≡ 总增益（判据里逐位断言），
 *   因此「每一项贡献」相加正好等于评分本身，不会出现「拆解和 ≠ 总分」。
 *   为什么不用「顺序边际」或「最后一个删掉」：两者都依赖顺序、且不可加——
 *   实测 3 异常队（1261/1221/1171）：顺序边际和 77.81%（= 真值，纯属巧合）、
 *   leave-one-out 和 87.82%（超出真值 10pp）——穿透、暴击×暴伤这类乘区**互相放大**，
 *   单项边际加起来会超过总增益。Shapley 是这套公理下唯一可加的分摊。
 * - **求值成本**（实测 2026-10-23，本机）：单点 18–32ms；玩家数 n≤12 时全子集 2^n 次；
 *   3 队实测 n=6/7/9 ⇒ 1.2s / 3.7s / 9.2s。n 超过 `MAX_EXACT_PLAYERS` 时自动退化为
 *   **按槽位分组**的精确 Shapley（玩家 = 槽位，≤3 玩家 = 8 次求值），结果标 `coarse: true`。
 * - **轴态**：词条可能改变失衡次数（实测琉音 critRate 抬冲击力 ⇒ 失衡 6→7），
 *   跨轴态那部分不是"词条收益"而是轴态跳变。本模块**照实计入**（评分 = 当前配装值多少），
 *   但把两个基线各自的 `stunCount` / `coverage` 一并返回，供展示层提示「本评价跨了轴态」。
 *
 * ## 运行位置
 * 必须跑在**独立场景**上（`withAnalysisScenario`）：本模块只读 `AnalysisContext`，
 * 结束时把三个槽位的分配还原（`finally`）。判据见 `composables/__tests__/substatScore.test.ts`
 * 与 `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS` 源码锁。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { SubstatAxisSignature } from '@/composables/substatCurve'

/** 精确 Shapley 的玩家数上限（2^n 次求值）；超过则退化为按槽位分组 */
export const MAX_EXACT_PLAYERS = 12

/** 一个「玩家」= 某槽位的某个副词条（整条词条一起投/不投，不拆步数） */
export interface SubstatPlayer {
  slot: number
  stat: string
  steps: number
}

export interface SubstatScoreContribution {
  slot: number
  /** 词条键；`*` = 该槽位整组（`coarse` 模式下合并） */
  stat: string
  steps: number
  /** 该词条对全队伤害的贡献，百分点（负值 = 当前配装下反而降低伤害，如溢出的暴击率） */
  pct: number
  /** 占全部贡献的份额（%）；总贡献为 0 时为 0 */
  sharePct: number
}

/**
 * 轴态签名（失衡次数 + 易伤覆盖率）：跨轴态的评价要在展示层提示。
 * 类型与「副词条收益曲线」共用同一份定义（规则 11：跨文件类型只从单一来源引用；
 * 同名两份定义会被 `banyueRageCycleSingleSourceCc460` 的防复发判据抓红）。
 */
export type { SubstatAxisSignature } from '@/composables/substatCurve'

export interface SubstatScoreResult {
  /** 百分比分母：0 副词条时的队伍总伤 */
  zeroDamage: number
  /** 当前配装的队伍总伤 */
  currentDamage: number
  /** 评分本身：当前副词条相对 0 副词条的全队伤害增益（%） */
  gainPct: number
  /** 逐词条贡献（Shapley 值），Σ = gainPct */
  contributions: SubstatScoreContribution[]
  /** true = 退化拆解（玩家 = 槽位而非单个词条） */
  coarse: boolean
  /** 实际求值次数（成本可核对，测试据此断言子集复用） */
  evals: number
  zeroAxis: SubstatAxisSignature
  currentAxis: SubstatAxisSignature
  /** true = 两个基线之间轴态变了（失衡次数不同 / 覆盖率差 >1 个百分点） */
  axisChanged: boolean
  /** 被取消 ⇒ false（contributions 只含已算部分） */
  complete: boolean
  reason: string
}

export interface SubstatScoreOptions {
  control?: BatchControl
  /** 只拆这些槽位（缺省 = 队伍全部槽位） */
  slots?: readonly number[]
  /** 每多少次求值让出一次主线程（缺省 16） */
  yieldEvery?: number
}

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 队伍里所有「非空槽位 × 非零词条」——拆解的玩家集合（顺序稳定：槽位 → 词条名字典序） */
export function collectSubstatPlayers(
  team: ReadonlyArray<{ driveDisc?: { subStatAllocation?: Record<string, number> } }>,
): SubstatPlayer[] {
  const out: SubstatPlayer[] = []
  for (let slot = 0; slot < team.length; slot++) {
    const alloc = team[slot]?.driveDisc?.subStatAllocation ?? {}
    for (const stat of Object.keys(alloc).sort()) {
      const steps = alloc[stat] ?? 0
      if (steps > 0) out.push({ slot, stat, steps })
    }
  }
  return out
}

function popcount(x: number): number {
  let c = 0
  while (x) { c += x & 1; x >>= 1 }
  return c
}

/** 二项式系数（只用于 Shapley 权重，n ≤ 12 时整数精确） */
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/**
 * 精确 Shapley：2^n 子集全枚举、每个子集只求值一次（空集与全集复用已算好的基线）。
 *
 * 有效性：Σ φ_i = v(全集) − v(∅)（Shapley 公理之一）——判据里断言，防"拆解和 ≠ 总分"。
 * 权重 w(k) = 1 / (n · C(n−1, k))，与 k!(n−k−1)!/n! 等价但没有大数阶乘。
 */
export async function shapleyValues(
  n: number,
  v0: number,
  vAll: number,
  value: (mask: number) => number,
  opts: { control?: BatchControl; yieldEvery?: number; onEval?: () => void } = {},
): Promise<{ shap: number[]; complete: boolean; evals: number }> {
  const total = 1 << n
  const memo = new Float64Array(total).fill(NaN)
  memo[0] = v0
  memo[total - 1] = vAll
  let complete = true
  const yieldEvery = Math.max(1, opts.yieldEvery ?? 16)
  for (let m = 1; m < total - 1; m++) {
    if (isBatchAborted(opts.control)) { complete = false; break }
    memo[m] = value(m)
    opts.onEval?.()
    if (m % yieldEvery === 0) await yieldToMacrotask()
  }
  const shap = new Array<number>(n).fill(0)
  if (!complete) return { shap, complete, evals: total - 1 }
  for (let j = 0; j < n; j++) {
    let acc = 0
    for (let m = 0; m < total; m++) {
      if (m & (1 << j)) continue
      const w = 1 / (n * binom(n - 1, popcount(m)))
      acc += w * (memo[m | (1 << j)]! - memo[m]!)
    }
    shap[j] = acc
  }
  return { shap, complete, evals: total - 1 }
}

/**
 * 计算「当前副词条 vs 0 副词条」的评分与逐词条贡献。
 *
 * 场景内会临时清空/写入 `subStatAllocation`，`finally` 恢复全部槽位原值（不留现场）。
 */
export async function scoreSubstats(
  scenario: AnalysisContext,
  opts: SubstatScoreOptions = {},
): Promise<SubstatScoreResult> {
  const { config, calc } = scenario
  const original = config.team.map(c => ({ ...c.driveDisc.subStatAllocation }));
  const slots = opts.slots?.length ? [...opts.slots] : config.team.map((_, i) => i)
  const readDamage = () => calc.teamTotalDamage.value
  const readAxis = (): SubstatAxisSignature => ({
    stunCount: calc.stunPoolResult.value?.stunCount ?? -1,
    coverage: calc.stunCoverage.value,
  })
  const fail = (reason: string, zeroAxis?: SubstatAxisSignature, currentAxis?: SubstatAxisSignature): SubstatScoreResult => ({
    zeroDamage: 0, currentDamage: 0, gainPct: 0, contributions: [], coarse: false, evals: 0,
    zeroAxis: zeroAxis ?? { stunCount: -1, coverage: 0 },
    currentAxis: currentAxis ?? { stunCount: -1, coverage: 0 },
    axisChanged: false, complete: false, reason,
  })
  try {
    // ⚠ 在**真实槽位号**空间里收集（空槽会被压缩 ⇒ 数组下标 ≠ 槽位号，AGENTS §2）；
    // 不用 `collectSubstatPlayers(config.team)` 再按下标映射，那条路会错位。
    const players: SubstatPlayer[] = []
    for (const slot of slots) {
      const alloc = config.team[slot].driveDisc.subStatAllocation
      for (const stat of Object.keys(alloc).sort()) {
        const steps = alloc[stat] ?? 0
        if (steps > 0) players.push({ slot, stat, steps })
      }
    }
    if (players.length === 0) return fail('当前队伍没有任何副词条')
    const exact = players.length <= MAX_EXACT_PLAYERS
    // 退化拆解的玩家 = 槽位整组（≤3 个玩家 = 8 次求值）
    const list: SubstatPlayer[] = exact
      ? players
      : slots.filter(slot => players.some(p => p.slot === slot))
        .map(slot => ({
          slot,
          stat: '*',
          steps: players.filter(p => p.slot === slot).reduce((a, p) => a + p.steps, 0),
        }))
    const setMask = (mask: number) => {
      for (let i = 0; i < config.team.length; i++) {
        const c = config.team[i]
        if (!c) continue
        if (!slots.includes(i)) { c.driveDisc.subStatAllocation = { ...original[i] }; continue }
        const gi = list.findIndex(player => player.slot === i)
        const on = gi >= 0 && (mask & (1 << gi)) !== 0
        c.driveDisc.subStatAllocation = on ? { ...original[i] } : {}
      }
    }
    setMask(0)
    const zeroDamage = readDamage()
    const zeroAxis = readAxis()
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
    const currentDamage = readDamage()
    const currentAxis = readAxis()
    if (!(zeroDamage > 0)) return fail('0 副词条时队伍总伤为 0：增益百分比没有分母', zeroAxis, currentAxis)
    const gainPct = (currentDamage / zeroDamage - 1) * 100
    const { shap, complete } = await shapleyValues(list.length, zeroDamage, currentDamage, mask => {
      setMask(mask)
      return readDamage()
    }, { control: opts.control, yieldEvery: opts.yieldEvery });
    const contributions: SubstatScoreContribution[] = list.map((player, i) => ({
      slot: player.slot,
      stat: player.stat,
      steps: player.steps,
      pct: (shap[i]! / zeroDamage) * 100,
      sharePct: 0,
    }))
    const sumPct = contributions.reduce((a, c) => a + c.pct, 0)
    for (const c of contributions) c.sharePct = sumPct !== 0 ? (c.pct / sumPct) * 100 : 0
    return {
      zeroDamage,
      currentDamage,
      gainPct,
      contributions,
      coarse: !exact,
      evals: (1 << list.length) - 1,
      zeroAxis,
      currentAxis,
      axisChanged: zeroAxis.stunCount !== currentAxis.stunCount
        || Math.abs(zeroAxis.coverage - currentAxis.coverage) > 0.01,
      complete,
      reason: '',
    }
  } finally {
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
  }
}
