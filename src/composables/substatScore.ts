/**
 * 副词条评分 + 驱动盘 A/B 对比（2026-10-23）。
 *
 * ## 两种用法（用户口径 2026-10-23）
 * > 「副词条评分该算单人的，因为有人要算他对一个角色的词条养成进度。
 * >   也有人要比较两套盘子谁的伤害高」
 *
 * ① **单人评分**（`scoreSubstats(s, { slot })`）：基线 = **只把该槽位**的副词条清零
 *    （其余槽位保持原样），目标 = 当前。回答「这个角色这套词条一共值多少」。
 *    同时给两个分母：**该角色自身伤害**（养成进度看这个）与**全队伤害**（这个角色值不值看这个）。
 * ② **两套盘子对比**（`compareDiscPlans(s, { slot, a, b })`）：分别装上 A / B 两份
 *    完整驱动盘配置（套装 + 主词条 + 副词条），读两次伤害。回答「哪套更疼、差多少」。
 *
 * ## 为什么单人评分是主用法（而不只是"选项"）
 * - **成本差一个数量级**：一个槽位的词条数实测 2`4（`{精通20, 大攻击12}` 这类），
 *   2^n−1 = 3`15 次求值 ≈ 0.1`0.4s ⇒ 可以进页面就算；全队 3 槽 6`9 个词条要 63`511 次（1`10s）。
 * - **口径更诚实**：全队口径下辅助的词条几乎不显影（他的词条本来就不为伤害服务），
 *   而「该角色自身伤害」才能反映词条养成进度。两个数一起给，读者自己选口径。
 *
 * ## 拆解（仍是精确 Shapley）
 * 玩家 = 该槽位的一个词条。Shapley 满足**有效性**：Σ 各词条贡献 ≡ 总增益（判据逐位断言），
 * 所以「每条词条值多少」相加正好等于评分。
 * 为什么不用单项边际（只删这一条 / 顺序边际）：词条之间会互相放大（攻击×暴击×暴伤、
 * 穿透的非线性防御区）⇒ 单项边际不可加。实测 3 异常队：leave-one-out 和 87.82% vs 真值 77.81%。
 *
 * ## 轴态
 * 词条可能改变失衡次数（实测琉音 critRate 抬冲击力 ⇒ 失衡 6→7）。跨轴态那部分不是"词条收益"，
 * 而是「多了这一次失衡」的整窗易伤差。照实计入（评分 = 当前配装值多少），但把两侧轴态一并返回，
 * 供展示层提示。
 *
 * ## 运行位置
 * 必须跑在**独立场景**上（`withAnalysisScenario`）：只读 `AnalysisContext`，结束时恢复全部槽位原值。
 * 判据 `composables/__tests__/substatScore.test.ts` + `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS`。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { SubstatAxisSignature } from '@/composables/substatCurve'
import { useCatalogStore } from '@/stores/catalog'
import type { DriveDiscConfig } from '@/types/catalog'

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
  /** 对**全队**伤害的贡献，百分点 */
  pct: number
  /** 对**该角色自身**伤害的贡献，百分点（单人模式的主口径） */
  ownPct: number
  /** 占全队口径合计的份额（%）；合计为 0 时为 0 */
  sharePct: number
}

/**
 * 轴态签名（失衡次数 + 易伤覆盖率）：跨轴态的评价要在展示层提示。
 * 类型与「副词条收益曲线」共用同一份定义（规则 11：跨文件类型只从单一来源引用；
 * 同名两份定义会被 `banyueRageCycleSingleSourceCc460` 的防复发判据抓红）。
 */
export type { SubstatAxisSignature } from '@/composables/substatCurve'

export interface SubstatScoreResult {
  /** 本次评分的槽位；`null` = 全队模式（所有槽位的词条一起算） */
  slot: number | null
  /** 分母：0 词条时的全队总伤 */
  zeroTeam: number
  /** 当前配装的全队总伤 */
  currentTeam: number
  /** 分母：0 词条时该槽位自身的伤害（`slot = null` 时 = 全队） */
  zeroOwn: number
  /** 当前配装下该槽位自身的伤害 */
  currentOwn: number
  /** 评分（全队口径）：当前 / 0 词条 − 1（%） */
  gainPct: number
  /** 评分（该角色自身口径）：当前 / 0 词条 − 1（%） */
  ownGainPct: number
  /** 逐词条贡献（Shapley），Σ pct ≡ gainPct、Σ ownPct ≡ ownGainPct */
  contributions: SubstatScoreContribution[]
  /** true = 退化拆解（玩家 = 槽位而非单个词条） */
  coarse: boolean
  /** 实际求值次数（成本可核对：`2^n − 1`） */
  evals: number
  zeroAxis: SubstatAxisSignature
  currentAxis: SubstatAxisSignature
  /** true = 两个基线之间轴态变了（失衡次数不同 / 覆盖率差 > 1 个百分点） */
  axisChanged: boolean
  /** 被取消 ⇒ false */
  complete: boolean
  reason: string
}

export interface SubstatScoreOptions {
  control?: BatchControl
  /** 评分哪个槽位（单人模式 = 主用法）；缺省 = 全队模式（所有槽位的词条一起算） */
  slot?: number
  /** 每多少次求值让出一次主线程（缺省 16） */
  yieldEvery?: number
}

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 队伍里所有「非空槽位 × 非零词条」——拆解的玩家集合（顺序稳定：槽位 → 词条名字典序） */
export function collectSubstatPlayers(
  team: ReadonlyArray<{ driveDisc: { subStatAllocation: Record<string, number> } }>,
  slots?: readonly number[],
): SubstatPlayer[] {
  const out: SubstatPlayer[] = []
  for (let slot = 0; slot < team.length; slot++) {
    if (slots && !slots.includes(slot)) continue
    const alloc = team[slot].driveDisc.subStatAllocation
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
 * `value` 返回 `number[]` ⇒ **一次求值同时算多个指标**（全队伤害 + 该角色伤害），
 * 不让「多给一个口径」变成多跑一遍子集。
 */
export async function shapleyValues(
  n: number,
  v0: number[],
  vAll: number[],
  value: (mask: number) => number[],
  opts: { control?: BatchControl; yieldEvery?: number; onEval?: () => void } = {},
): Promise<{ shap: number[][]; complete: boolean; evals: number }> {
  const dims = v0.length
  const total = 1 << n
  const memo: number[][] = new Array(total)
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
  const shap: number[][] = Array.from({ length: dims }, () => new Array<number>(n).fill(0))
  if (!complete) return { shap, complete, evals: total - 1 }
  for (let j = 0; j < n; j++) {
    for (let m = 0; m < total; m++) {
      if (m & (1 << j)) continue
      const w = 1 / (n * binom(n - 1, popcount(m)))
      const hi = memo[m | (1 << j)]!
      const lo = memo[m]!
      for (let d = 0; d < dims; d++) shap[d]![j]! += w * (hi[d]! - lo[d]!)
    }
  }
  return { shap, complete, evals: total - 1 }
}

/** 一次求值读出的两个指标（同一份管线结果，不是两次求值） */
export interface DamageReading {
  /** 全队总伤 */
  team: number
  /** 该槽位自身伤害（`slot = null` 时 = 全队） */
  own: number
}

/**
 * 计算「当前副词条 vs 0 副词条」的评分与逐词条贡献。
 *
 * `opts.slot` 给了 ⇒ **只动该槽位**的词条（其余槽位保持原值）——单人评分、养成进度用这个。
 * 缺省 ⇒ 全队模式（所有槽位一起清零/恢复）。
 * 场景内会临时改写 `subStatAllocation`，`finally` 恢复全部槽位原值（不留现场）。
 */
export async function scoreSubstats(
  scenario: AnalysisContext,
  opts: SubstatScoreOptions = {},
): Promise<SubstatScoreResult> {
  const { config, calc } = scenario
  const original = config.team.map(c => ({ ...c.driveDisc.subStatAllocation }))
  const slot = typeof opts.slot === 'number' ? opts.slot : null
  const slots = slot === null ? config.team.map((_, i) => i) : [slot]
  /** 一次求值同时读「全队」与「该槽自身」（同一份 `damagePoolRows`，零额外成本） */
  const read = (): DamageReading => {
    const team = calc.teamTotalDamage.value
    if (slot === null) return { team, own: team }
    let own = 0
    for (const row of calc.damagePoolRows.value) if (row.slot === slot) own += row.totalDamage
    return { team, own }
  }
  const readAxis = (): SubstatAxisSignature => ({
    stunCount: calc.stunPoolResult.value?.stunCount ?? -1,
    coverage: calc.stunCoverage.value,
  })
  const fail = (reason: string, zeroAxis?: SubstatAxisSignature, currentAxis?: SubstatAxisSignature): SubstatScoreResult => ({
    slot, zeroTeam: 0, currentTeam: 0, zeroOwn: 0, currentOwn: 0, gainPct: 0, ownGainPct: 0,
    contributions: [], coarse: false, evals: 0,
    zeroAxis: zeroAxis ?? { stunCount: -1, coverage: 0 },
    currentAxis: currentAxis ?? { stunCount: -1, coverage: 0 },
    axisChanged: false, complete: false, reason,
  })
  try {
    const players = collectSubstatPlayers(config.team, slots)
    if (players.length === 0) return fail(slot === null ? '当前队伍没有任何副词条' : '该角色没有副词条')
    const exact = players.length <= MAX_EXACT_PLAYERS
    // 退化拆解的玩家 = 槽位整组（单人模式只有 1 个玩家 ⇒ 贡献 = 整槽，等价于「不拆」）
    const list: SubstatPlayer[] = exact
      ? players
      : slots.filter(s => players.some(p => p.slot === s))
        .map(s => ({
          slot: s,
          stat: '*',
          steps: players.filter(p => p.slot === s).reduce((a, p) => a + p.steps, 0),
        }))
    /**
     * 把 `mask` 落在**逐词条**粒度上（不是「整槽」）。
     *
     * ⚠ 2026-10-23 实机抓到：首版按「槽位整组」写回 `original[i]` ⇒ 任意一条词条的位被打开时，
     * 该槽**全部**词条一起生效 ⇒ 同槽第二条词条在所有子集里都拿不到独立边际，Shapley 恒 0
     * （实机表现：三条「大攻击」全显示 +0%）。而 Σ ≡ 评分的判据仍然绿（第一条独吞整槽收益）
     * ——**"拆解看着自洽但其实是错的"**，只能靠「同槽每条词条都必须非零」这类判据抓。
     *
     * 范围外的槽位保持原值（单人模式下 = 队友的词条完全不动，这是「只评这个角色」的定义）。
     */
    const setMask = (mask: number) => {
      for (let i = 0; i < config.team.length; i++) {
        const c = config.team[i]
        if (!c) continue
        if (!slots.includes(i)) { c.driveDisc.subStatAllocation = { ...original[i] }; continue }
        const alloc: Record<string, number> = {}
        list.forEach((player, gi) => {
          if (player.slot !== i) return
          if ((mask & (1 << gi)) === 0) return
          if (player.stat === '*') Object.assign(alloc, original[i])
          else alloc[player.stat] = player.steps
        })
        c.driveDisc.subStatAllocation = alloc
      }
    }
    // 0 词条基线 = 「本评分范围内的槽位全部不投词条」（走同一 `setMask`，单一写入点：
    // `liteTeamAssemblySource.test.ts` 的 CC-256 源锁规定 composables 下清空分配只许出现在 teamTimelineStore）。
    setMask(0)
    const zero = read()
    const zeroAxis = readAxis()
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
    const current = read()
    const currentAxis = readAxis()
    if (!(zero.team > 0)) return fail('0 副词条时队伍总伤为 0：增益百分比没有分母', zeroAxis, currentAxis)
    const gainPct = (current.team / zero.team - 1) * 100
    const ownGainPct = zero.own > 0 ? (current.own / zero.own - 1) * 100 : 0
    const { shap, complete } = await shapleyValues(
      list.length,
      [zero.team, zero.own],
      [current.team, current.own],
      mask => {
        setMask(mask)
        const r = read()
        return [r.team, r.own]
      },
      { control: opts.control, yieldEvery: opts.yieldEvery },
    )
    const contributions: SubstatScoreContribution[] = list.map((player, i) => ({
      slot: player.slot,
      stat: player.stat,
      steps: player.steps,
      pct: (shap[0]![i]! / zero.team) * 100,
      ownPct: zero.own > 0 ? (shap[1]![i]! / zero.own) * 100 : 0,
      sharePct: 0,
    }))
    const sumPct = contributions.reduce((a, c) => a + c.pct, 0)
    for (const c of contributions) c.sharePct = sumPct !== 0 ? (c.pct / sumPct) * 100 : 0
    return {
      slot,
      zeroTeam: zero.team,
      currentTeam: current.team,
      zeroOwn: zero.own,
      currentOwn: current.own,
      gainPct,
      ownGainPct,
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

// ============================================================================
// 两套盘子 A/B 对比
// ============================================================================

/**
 * 一份完整驱动盘配置（套装 + 主词条 + 副词条）——A/B 对比的单位。
 * 直接复用引擎类型 `DriveDiscConfig`（规则 11：同形不改写；判据 29 也禁止结构副本）。
 */
export type DiscPlan = DriveDiscConfig

/** 一处差异：套装 / 主词条 / 副词条 */
export type DiscPlanDiffKind = '套装4' | '套装2' | '主词条' | '副词条'

export interface DiscPlanDiff {
  kind: DiscPlanDiffKind
  /** 差异落在哪个字段（如「4 号位」「大攻击」） */
  label: string
  a: string
  b: string
}

export interface DiscCompareResult {
  slot: number
  aTeam: number
  bTeam: number
  aOwn: number
  bOwn: number
  /** (B − A) / A × 100，全队口径 */
  deltaTeamPct: number
  /** (B − A) / A × 100，该角色自身口径 */
  deltaOwnPct: number
  /** 逐项差异（套装 / 主词条 / 副词条；相等项不列） */
  diff: DiscPlanDiff[]
  /** 总副词条步数（A / B） */
  stepsA: number
  stepsB: number
  complete: boolean
  reason: string
}

export interface DiscCompareOptions {
  slot: number
  a: DiscPlan
  b: DiscPlan
  control?: BatchControl
}

/** 读当前槽位的完整驱动盘配置（"把当前这套存成 A" 的入口） */
export function readDiscPlan(
  slot: number,
  team: ReadonlyArray<{ driveDisc: DriveDiscConfig }>,
): DiscPlan {
  const disc = team[slot].driveDisc
  return {
    fourPieceSetId: disc.fourPieceSetId,
    twoPieceSetId: disc.twoPieceSetId,
    mainStats: { ...disc.mainStats },
    subStatAllocation: { ...disc.subStatAllocation },
  }
}

/** 词条 / 主词条的中文简称（与 `data/substatLabels` 同口径；主词条池多几个键） */
const STAT_LABEL: Readonly<Record<string, string>> = {
  atkPct: '大攻击', atkFlat: '小攻击', hpPct: '大生命', hpFlat: '小生命',
  defPct: '大防御', defFlat: '小防御', critRate: '暴击率', critDmg: '爆伤',
  anomalyProficiency: '精通', penFlat: '小穿透',
  penRatio: '穿透率', physicalDmg: '物理增伤', fireDmg: '火增伤', iceDmg: '冰增伤',
  electricDmg: '电增伤', etherDmg: '以太增伤', windDmg: '风增伤', anomalyMastery: '异常掌控',
  energyRegen: '能量回复', impact: '冲击力',
}

export function discStatLabel(stat: string): string {
  return STAT_LABEL[stat] ?? stat
}

/** 两份配装的逐项差异（套装名从 catalog 查；查不到回落 id） */
export function diffDiscPlans(a: DiscPlan, b: DiscPlan): DiscPlanDiff[] {
  const catalog = useCatalogStore()
  const setName = (id: string): string => {
    if (!id) return '（无）'
    const set = catalog.driveDiscSetsMap.get(id)
    return set ? (set.name.zhCN || id) : id
  }
  const out: DiscPlanDiff[] = []
  if (a.fourPieceSetId !== b.fourPieceSetId) {
    out.push({ kind: '套装4', label: '四件套', a: setName(a.fourPieceSetId), b: setName(b.fourPieceSetId) })
  }
  if (a.twoPieceSetId !== b.twoPieceSetId) {
    out.push({ kind: '套装2', label: '二件套', a: setName(a.twoPieceSetId), b: setName(b.twoPieceSetId) })
  }
  for (const pos of [4, 5, 6] as const) {
    const av = a.mainStats[pos] ?? ''
    const bv = b.mainStats[pos] ?? ''
    if (av !== bv) {
      out.push({
        kind: '主词条',
        label: pos + ' 号位',
        a: av ? discStatLabel(av) : '（空）',
        b: bv ? discStatLabel(bv) : '（空）',
      })
    }
  }
  const stats = new Set([...Object.keys(a.subStatAllocation), ...Object.keys(b.subStatAllocation)])
  for (const stat of [...stats].sort()) {
    const av = a.subStatAllocation[stat] ?? 0
    const bv = b.subStatAllocation[stat] ?? 0
    if (av !== bv) out.push({ kind: '副词条', label: discStatLabel(stat), a: av + ' 步', b: bv + ' 步' })
  }
  return out
}

/**
 * 对比两套驱动盘配置：分别装到 `slot` 上求值，读「全队」与「该角色自身」两个伤害。
 *
 * 口径：A、B 各自**完整覆盖**该槽位的套装/主词条/副词条（不是"只换盘子"），
 * 其它槽位完全不动 ⇒ 差异只来自这一槽的配装。
 * `diff` / `stepsA|B` 都是同一次读取的派生量，不另存第二份。
 */
export async function compareDiscPlans(
  scenario: AnalysisContext,
  opts: DiscCompareOptions,
): Promise<DiscCompareResult> {
  const { config, calc } = scenario
  const { slot, a, b } = opts
  const original = config.team.map(c => ({ ...c.driveDisc.subStatAllocation }))
  const originalDisc = {
    fourPieceSetId: config.team[slot].driveDisc.fourPieceSetId,
    twoPieceSetId: config.team[slot].driveDisc.twoPieceSetId,
    mainStats: { ...config.team[slot].driveDisc.mainStats },
  }
  const read = (): DamageReading => {
    const team = calc.teamTotalDamage.value
    let own = 0
    for (const row of calc.damagePoolRows.value) if (row.slot === slot) own += row.totalDamage
    return { team, own }
  }
  const apply = (plan: DiscPlan) => {
    const disc = config.team[slot].driveDisc
    disc.fourPieceSetId = plan.fourPieceSetId
    disc.twoPieceSetId = plan.twoPieceSetId
    disc.mainStats = { ...plan.mainStats };
    disc.subStatAllocation = { ...plan.subStatAllocation }
  }
  const fail = (reason: string): DiscCompareResult => ({
    slot, aTeam: 0, bTeam: 0, aOwn: 0, bOwn: 0, deltaTeamPct: 0, deltaOwnPct: 0,
    diff: [], stepsA: 0, stepsB: 0, complete: false, reason,
  })
  try {
    apply(a)
    const ra = read()
    apply(b)
    const rb = read()
    if (!(ra.team > 0) || !(rb.team > 0)) return fail('至少一套配装的全队总伤为 0：百分比没有分母')
    const sum = (m: Record<string, number>) => Object.values(m).reduce((x, y) => x + y, 0)
    return {
      slot,
      aTeam: ra.team,
      bTeam: rb.team,
      aOwn: ra.own,
      bOwn: rb.own,
      deltaTeamPct: (rb.team / ra.team - 1) * 100,
      deltaOwnPct: ra.own > 0 ? (rb.own / ra.own - 1) * 100 : 0,
      diff: diffDiscPlans(a, b),
      stepsA: sum(a.subStatAllocation),
      stepsB: sum(b.subStatAllocation),
      complete: true,
      reason: '',
    }
  } finally {
    const disc = config.team[slot].driveDisc
    disc.fourPieceSetId = originalDisc.fourPieceSetId
    disc.twoPieceSetId = originalDisc.twoPieceSetId
    disc.mainStats = { ...originalDisc.mainStats };
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
  }
}
